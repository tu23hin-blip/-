import { insights, metaObjects, optimizerActions } from '../db/repositories/meta.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { deliverables } from '../db/repositories/production.ts';
import { notifications } from '../db/repositories/system.ts';
import { parseJson } from '../db/sqlite.ts';
import { addDays, jstDateString } from '../lib/date.ts';
import { safeDiv } from '../lib/money.ts';
import { createLogger } from '../lib/logger.ts';
import { updateObject } from './client.ts';
import type { AutopilotLevel, Brief, Insight, MetaObject, Project } from '../domain/types.ts';

const log = createLogger('meta:optimizer');

/**
 * Meta 運用の自動最適化。
 *
 * ルールは「提案（suggest）」として必ず記録し、案件の autopilot_level に応じて適用する。
 *   off       … 何もしない
 *   suggest   … 記録のみ（人が判断）
 *   auto_safe … 損失を止める方向（停止・減額・クリエイティブ追加依頼）のみ自動適用
 *   auto_full … 増額・複製も含めて自動適用
 *
 * 「自動で予算を増やす」は事故が大きいので、既定は auto_safe を想定している。
 */

export type Proposal = {
  rule: string;
  level: 'campaign' | 'adset' | 'ad';
  objectId: string;
  objectName: string;
  action: 'pause' | 'scale_budget' | 'reduce_budget' | 'duplicate' | 'request_creative' | 'alert';
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** auto_safe で自動適用してよいか */
  safe: boolean;
};

export type Metrics = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  frequency: number;
  ctr: number;
  cpa: number;
  cpm: number;
  cvr: number;
  roas: number;
};

export function aggregate(rows: Insight[]): Metrics {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const revenue = rows.reduce((s, r) => s + r.conversion_value, 0);
  const frequency = rows.length ? rows.reduce((s, r) => s + r.frequency, 0) / rows.length : 0;
  return {
    spend, impressions, clicks, conversions, revenue, frequency,
    ctr: safeDiv(clicks, impressions) * 100,
    cpa: conversions > 0 ? Math.round(spend / conversions) : 0,
    cpm: safeDiv(spend, impressions) * 1000,
    cvr: safeDiv(conversions, clicks) * 100,
    roas: safeDiv(revenue, spend),
  };
}

const WINDOW_DAYS = 3;

export function buildProposals(projectId: string, date = jstDateString()): Proposal[] {
  const project = projects.require(projectId);
  const from = addDays(date, -WINDOW_DAYS);
  const proposals: Proposal[] = [];
  const targetCpa = project.target_cpa || 0;

  const ads = metaObjects.list(projectId, 'ad');
  const adSets = metaObjects.list(projectId, 'adset');
  const activeAds = ads.filter((a) => a.status === 'ACTIVE');

  // ---- 広告単位 ----
  for (const ad of activeAds) {
    const rows = insights.forObject(ad.id, from, date);
    if (rows.length === 0) continue;
    const m = aggregate(rows);

    // 1) 学習期間を超えて成果が出ない広告は止める（費用の垂れ流しを防ぐ）
    if (targetCpa > 0 && m.spend >= targetCpa * 3 && m.conversions === 0) {
      proposals.push({
        rule: 'stop_loss_no_conversion',
        level: 'ad', objectId: ad.id, objectName: ad.name, action: 'pause',
        reason: `直近${WINDOW_DAYS}日で消化 ${m.spend.toLocaleString()}円（目標CPAの3倍超）に対しCV 0件。`,
        before: { status: 'ACTIVE', spend: m.spend, conversions: 0 },
        after: { status: 'PAUSED' },
        safe: true,
      });
      continue;
    }

    // 2) CPA が目標を大きく超過
    if (targetCpa > 0 && m.conversions > 0 && m.cpa > targetCpa * 1.5 && m.spend >= targetCpa) {
      proposals.push({
        rule: 'stop_loss_high_cpa',
        level: 'ad', objectId: ad.id, objectName: ad.name, action: 'pause',
        reason: `CPA ${m.cpa.toLocaleString()}円 が目標 ${targetCpa.toLocaleString()}円 の1.5倍を超過（CV ${m.conversions}件）。`,
        before: { status: 'ACTIVE', cpa: m.cpa },
        after: { status: 'PAUSED' },
        safe: true,
      });
      continue;
    }

    // 3) 配信されていない（審査落ち・ターゲット過少の疑い）
    if (m.impressions === 0 && rows.length >= 2) {
      proposals.push({
        rule: 'zero_delivery',
        level: 'ad', objectId: ad.id, objectName: ad.name, action: 'alert',
        reason: `${rows.length}日間インプレッション0。広告審査落ち、または広告セットの設定を確認してください。`,
        before: { impressions: 0 },
        after: {},
        safe: true,
      });
    }

    // 4) 疲弊検知 → 新しいクリエイティブを自動発注する
    const fatigued = m.frequency >= 2.5 || isCtrDeclining(ad.id, date);
    if (fatigued && m.spend > 0) {
      proposals.push({
        rule: 'creative_fatigue',
        level: 'ad', objectId: ad.id, objectName: ad.name, action: 'request_creative',
        reason: `フリークエンシー ${m.frequency.toFixed(2)}／CTR低下を検知。新規クリエイティブの投入が必要です。`,
        before: { frequency: m.frequency, ctr: Number(m.ctr.toFixed(3)) },
        after: { requestType: 'video_ad' },
        safe: true,
      });
    }
  }

  // ---- 広告セット単位（予算配分） ----
  for (const adSet of adSets) {
    if (adSet.status !== 'ACTIVE') continue;
    const rows = insights.forObject(adSet.id, from, date);
    if (rows.length === 0) continue;
    const m = aggregate(rows);
    const budget = adSet.daily_budget ?? 0;
    if (budget <= 0) continue;

    if (targetCpa > 0 && m.conversions >= 3 && m.cpa > 0 && m.cpa <= targetCpa * 0.8) {
      const next = Math.min(Math.round(budget * 1.2), budget * 2, Math.max(budget, project.daily_budget * 2 || budget * 2));
      if (next > budget) {
        proposals.push({
          rule: 'scale_winner',
          level: 'adset', objectId: adSet.id, objectName: adSet.name, action: 'scale_budget',
          reason: `CPA ${m.cpa.toLocaleString()}円（目標比 ${Math.round((m.cpa / targetCpa) * 100)}%）、CV ${m.conversions}件。日予算を20%増額します。`,
          before: { dailyBudget: budget },
          after: { dailyBudget: next },
          safe: false,   // 増額は auto_full のみ
        });
      }
    }

    if (targetCpa > 0 && m.spend >= targetCpa * 2 && (m.conversions === 0 || m.cpa > targetCpa * 1.3)) {
      const next = Math.max(1000, Math.round(budget * 0.8));
      if (next < budget) {
        proposals.push({
          rule: 'reduce_underperformer',
          level: 'adset', objectId: adSet.id, objectName: adSet.name, action: 'reduce_budget',
          reason: `CPA ${m.cpa ? `${m.cpa.toLocaleString()}円` : '未達'}。日予算を20%減額して損失を抑えます。`,
          before: { dailyBudget: budget },
          after: { dailyBudget: next },
          safe: true,
        });
      }
    }
  }

  // ---- クリエイティブ在庫 ----
  const liveCreatives = activeAds.length;
  if (liveCreatives < 3) {
    proposals.push({
      rule: 'creative_pool_low',
      level: 'campaign',
      objectId: metaObjects.list(projectId, 'campaign')[0]?.id ?? projectId,
      objectName: project.name,
      action: 'request_creative',
      reason: `配信中クリエイティブが${liveCreatives}本。検証本数が不足しています（推奨: 3本以上）。`,
      before: { activeCreatives: liveCreatives },
      after: { requestType: 'video_ad', quantity: 3 - liveCreatives },
      safe: true,
    });
  }

  // ---- 予算ペース ----
  const pace = monthlyPace(project, date);
  if (pace && Math.abs(pace.deviation) > 0.2) {
    proposals.push({
      rule: 'budget_pacing',
      level: 'campaign',
      objectId: metaObjects.list(projectId, 'campaign')[0]?.id ?? projectId,
      objectName: project.name,
      action: 'alert',
      reason: pace.deviation > 0
        ? `月予算の消化ペースが計画比 +${Math.round(pace.deviation * 100)}%。月末までに予算超過の見込みです。`
        : `月予算の消化ペースが計画比 ${Math.round(pace.deviation * 100)}%。配信量が不足しています。`,
      before: { spentMtd: pace.spent, expected: pace.expected },
      after: {},
      safe: true,
    });
  }

  return proposals;
}

/** 直近3日と、その前3日の CTR を比較して低下傾向を判定 */
function isCtrDeclining(objectId: string, date: string): boolean {
  const recent = aggregate(insights.forObject(objectId, addDays(date, -3), date));
  const previous = aggregate(insights.forObject(objectId, addDays(date, -7), addDays(date, -4)));
  if (previous.impressions < 500 || recent.impressions < 500) return false;
  return recent.ctr < previous.ctr * 0.7;
}

function monthlyPace(project: Project, date: string): { spent: number; expected: number; deviation: number } | null {
  if (project.monthly_budget <= 0) return null;
  const monthStart = `${date.slice(0, 7)}-01`;
  const rows = insights.range(project.id, monthStart, date, 'campaign');
  const spent = rows.reduce((s, r) => s + r.spend, 0);
  const day = Number(date.slice(8, 10));
  const daysInMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  const expected = Math.round((project.monthly_budget / daysInMonth) * day);
  if (expected === 0) return null;
  return { spent, expected, deviation: (spent - expected) / expected };
}

function shouldApply(level: AutopilotLevel, proposal: Proposal): boolean {
  if (level === 'off' || level === 'suggest') return false;
  if (level === 'auto_full') return true;
  return proposal.safe;
}

export type OptimizeResult = {
  projectId: string;
  date: string;
  proposals: number;
  applied: number;
  createdOrders: string[];
};

export async function optimizeProject(projectId: string, date = jstDateString()): Promise<OptimizeResult> {
  const project = projects.require(projectId);
  const level = project.autopilot === 1 ? project.autopilot_level : 'off';
  const proposals = buildProposals(projectId, date);
  const createdOrders: string[] = [];
  let applied = 0;

  for (const proposal of proposals) {
    const record = optimizerActions.create({
      project_id: projectId,
      date,
      rule: proposal.rule,
      level: proposal.level,
      object_id: proposal.objectId,
      object_name: proposal.objectName,
      action: proposal.action,
      reason: proposal.reason,
      before: JSON.stringify(proposal.before),
      after: JSON.stringify(proposal.after),
      applied: 0,
    });

    if (!shouldApply(level, proposal)) {
      if (proposal.action === 'alert') {
        notifications.create({
          project_id: projectId, level: 'warn',
          title: `[${project.name}] ${proposal.rule}`,
          body: proposal.reason,
        });
      }
      continue;
    }

    try {
      switch (proposal.action) {
        case 'pause': {
          const object = metaObjects.require(proposal.objectId);
          await updateObject(object.remote_id ?? object.id, { status: 'PAUSED' });
          metaObjects.update(object.id, { status: 'PAUSED' });
          applied++;
          optimizerActions.markApplied(record.id);
          break;
        }
        case 'scale_budget':
        case 'reduce_budget': {
          const object = metaObjects.require(proposal.objectId);
          const next = Number(proposal.after['dailyBudget'] ?? 0);
          await updateObject(object.remote_id ?? object.id, { daily_budget: next });
          metaObjects.update(object.id, { daily_budget: next });
          applied++;
          optimizerActions.markApplied(record.id);
          break;
        }
        case 'request_creative': {
          const orderId = requestCreativeOrder(projectId, proposal);
          if (orderId) {
            createdOrders.push(orderId);
            applied++;
            optimizerActions.markApplied(record.id);
          }
          break;
        }
        case 'alert': {
          notifications.create({
            project_id: projectId, level: 'warn',
            title: `[${project.name}] ${proposal.rule}`, body: proposal.reason,
          });
          optimizerActions.markApplied(record.id);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      optimizerActions.markApplied(record.id, message);
      log.error('最適化アクションの適用に失敗', { rule: proposal.rule, error: message });
    }
  }

  log.info('最適化を実行', { projectId, date, proposals: proposals.length, applied, autopilot: level });
  return { projectId, date, proposals: proposals.length, applied, createdOrders };
}

/**
 * 疲弊・在庫不足を検知したら、自分でクリエイティブを発注する。
 * ここが「運用が制作を呼び、制作が運用に返る」自走ループの折り返し地点。
 */
function requestCreativeOrder(projectId: string, proposal: Proposal): string | null {
  const project = projects.require(projectId);

  // 同じ理由の自動発注が未完了で残っているなら重ねて出さない
  const inFlight = orders.list({ projectId }).filter(
    (o) => o.auto_generated === 1 && !['completed', 'cancelled', 'rejected', 'live'].includes(o.status),
  );
  if (inFlight.length >= 2) {
    log.debug('自動発注の上限に達しているためスキップ', { projectId, inFlight: inFlight.length });
    return null;
  }

  // 直近の勝ちクリエイティブのブリーフを引き継いで、勝ち筋を外さない
  const reference = bestPerformingBrief(projectId);
  const quantity = Number(proposal.after['quantity'] ?? 2);
  const brief: Brief = {
    ...reference,
    variations: Math.max(1, Math.min(3, quantity)),
    aspectRatios: reference.aspectRatios ?? ['9:16'],
    durationSec: reference.durationSec ?? 20,
  };

  const order = orders.create({
    project_id: projectId,
    type: 'video_ad',
    title: `[自動発注] 新規クリエイティブ ${quantity}本 — ${proposal.rule}`,
    brief: JSON.stringify(brief),
    quantity: brief.variations ?? 1,
    status: 'requested',
    priority: 3,
    media_amount: project.media_unit_price,
    client_amount: project.client_unit_price,
    auto_generated: 1,
    source_ref: `${proposal.rule}:${proposal.objectId}`,
    requested_by: 'autopilot',
  });

  notifications.create({
    project_id: projectId, level: 'info',
    title: `[${project.name}] クリエイティブを自動発注しました`,
    body: `${proposal.reason}\n発注ID: ${order.id}`,
  });
  log.info('クリエイティブを自動発注', { projectId, orderId: order.id, rule: proposal.rule });
  return order.id;
}

/** 直近でCPAが最も良かった広告のブリーフを取り出す（無ければ案件の最新ブリーフ） */
function bestPerformingBrief(projectId: string): Brief {
  const to = jstDateString();
  const from = addDays(to, -14);
  const ads = metaObjects.list(projectId, 'ad');
  let best: { cpa: number; ad: MetaObject } | null = null;

  for (const ad of ads) {
    const m = aggregate(insights.forObject(ad.id, from, to));
    if (m.conversions >= 2 && m.cpa > 0 && (!best || m.cpa < best.cpa)) best = { cpa: m.cpa, ad };
  }

  if (best?.ad.deliverable_id) {
    const deliverable = deliverables.find(best.ad.deliverable_id);
    const order = deliverable ? orders.find(deliverable.order_id) : null;
    if (order) return parseJson<Brief>(order.brief, {} as Brief);
  }
  const latest = orders.list({ projectId, type: 'video_ad', limit: 1 })[0];
  return latest ? parseJson<Brief>(latest.brief, {} as Brief) : ({} as Brief);
}
