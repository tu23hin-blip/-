import { insights, metaAccounts, metaObjects } from '../db/repositories/meta.ts';
import { projects } from '../db/repositories/projects.ts';
import { ledger } from '../db/repositories/finance.ts';
import { config } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { addDays, daysBetween, jstDateString } from '../lib/date.ts';
import { CONVERSION_ACTION_TYPES, actionValue, fetchInsights, isSandbox } from './client.ts';
import type { MetaObject } from '../domain/types.ts';

const log = createLogger('meta:sync');

/**
 * 実績数値の取り込み。
 *
 * サンドボックス時は「クリエイティブごとの素質 × 疲弊 × 日次のゆらぎ」で
 * 実データに近い形の数値を生成する。最適化ロジックを実アカウントなしで検証するため。
 */

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** 決定論的な擬似乱数（同じ日・同じ広告なら同じ値になる＝再実行しても壊れない） */
function rand(...parts: (string | number)[]): number {
  return seedOf(parts.join('|'));
}

function simulateAd(ad: MetaObject, date: string, dailyBudget: number, targetCpa: number) {
  const quality = 0.55 + rand(ad.id, 'quality') * 0.9;         // クリエイティブの素質 0.55〜1.45
  const ageDays = Math.max(0, daysBetween(ad.created_at.slice(0, 10), date));
  const fatigue = Math.max(0.45, 1 - ageDays * 0.035);          // 配信日数に応じて逓減
  const noise = 0.8 + rand(ad.id, date) * 0.4;

  const spend = Math.round(dailyBudget * (0.75 + rand(ad.id, date, 'spend') * 0.4));
  const cpm = Math.round(1400 / (quality * fatigue) * noise);
  const impressions = Math.round((spend / Math.max(300, cpm)) * 1000);
  const ctr = 0.008 * quality * fatigue * noise;
  const clicks = Math.max(0, Math.round(impressions * ctr));
  const cvr = 0.02 * quality * noise;
  const conversions = Math.max(0, Math.round(clicks * cvr));
  const aov = targetCpa > 0 ? targetCpa * 2.4 : 6800;

  return {
    spend,
    impressions,
    clicks,
    reach: Math.round(impressions / (1.15 + ageDays * 0.03)),
    frequency: Math.round((1.15 + ageDays * 0.03) * 100) / 100,
    conversions,
    conversion_value: Math.round(conversions * aov),
    video_p25: Math.round(impressions * 0.32 * fatigue),
    video_p75: Math.round(impressions * 0.11 * fatigue),
    thruplays: Math.round(impressions * 0.08 * fatigue),
  };
}

export type SyncResult = { projectId: string; date: string; rows: number; spend: number; conversions: number; sandbox: boolean };

export async function syncProject(projectId: string, date = jstDateString(new Date(Date.now() - 86_400_000))): Promise<SyncResult> {
  const project = projects.require(projectId);
  const account = metaAccounts.byProject(projectId);
  const adAccountId = account?.ad_account_id ?? config.meta.defaultAdAccountId;

  let rows = 0;
  let totalSpend = 0;
  let totalConversions = 0;

  if (isSandbox()) {
    const ads = metaObjects.list(projectId, 'ad');
    const activeAds = ads.filter((a) => a.status === 'ACTIVE');
    const budgetPerAd = activeAds.length
      ? Math.floor((project.daily_budget || Math.floor(project.monthly_budget / 30) || 10000) / activeAds.length)
      : 0;

    for (const ad of activeAds) {
      const metrics = simulateAd(ad, date, budgetPerAd, project.target_cpa);
      insights.upsert({
        project_id: projectId, date, level: 'ad', object_id: ad.id, remote_id: ad.remote_id,
        raw: JSON.stringify({ simulated: true }),
        ...metrics,
      });
      rows++;
      totalSpend += metrics.spend;
      totalConversions += metrics.conversions;
    }

    // 広告セット / キャンペーンは配下の合算で作る
    for (const level of ['adset', 'campaign'] as const) {
      for (const parent of metaObjects.list(projectId, level)) {
        const children = level === 'adset'
          ? metaObjects.children(parent.id).filter((c) => c.level === 'ad')
          : metaObjects.list(projectId, 'ad');
        const childRows = children
          .map((c) => insights.byDate(projectId, date, 'ad').find((r) => r.object_id === c.id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r));
        if (childRows.length === 0) continue;
        const sum = childRows.reduce(
          (acc, r) => ({
            spend: acc.spend + r.spend,
            impressions: acc.impressions + r.impressions,
            clicks: acc.clicks + r.clicks,
            reach: acc.reach + r.reach,
            conversions: acc.conversions + r.conversions,
            conversion_value: acc.conversion_value + r.conversion_value,
            video_p25: acc.video_p25 + r.video_p25,
            video_p75: acc.video_p75 + r.video_p75,
            thruplays: acc.thruplays + r.thruplays,
          }),
          { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversion_value: 0, video_p25: 0, video_p75: 0, thruplays: 0 },
        );
        insights.upsert({
          project_id: projectId, date, level, object_id: parent.id, remote_id: parent.remote_id,
          frequency: sum.reach ? Math.round((sum.impressions / sum.reach) * 100) / 100 : 0,
          raw: JSON.stringify({ simulated: true, children: childRows.length }),
          ...sum,
        });
        rows++;
      }
    }
  } else {
    for (const level of ['campaign', 'adset', 'ad'] as const) {
      const apiRows = await fetchInsights({ adAccountId, level, since: date, until: date });
      for (const row of apiRows) {
        const remoteId = level === 'ad' ? row.ad_id : level === 'adset' ? row.adset_id : row.campaign_id;
        if (!remoteId) continue;
        const local = metaObjects.byRemote(remoteId);
        if (!local) continue;
        const conversions = actionValue(row.actions, CONVERSION_ACTION_TYPES);
        const metrics = {
          spend: Math.round(Number(row.spend ?? 0)),
          impressions: Math.round(Number(row.impressions ?? 0)),
          clicks: Math.round(Number(row.clicks ?? 0)),
          reach: Math.round(Number(row.reach ?? 0)),
          frequency: Number(row.frequency ?? 0),
          conversions,
          conversion_value: Math.round(Number(actionValue(row.action_values, CONVERSION_ACTION_TYPES))),
          video_p25: Math.round(Number(row.video_p25_watched_actions?.[0]?.value ?? 0)),
          video_p75: Math.round(Number(row.video_p75_watched_actions?.[0]?.value ?? 0)),
          thruplays: Math.round(Number(row.video_thruplay_watched_actions?.[0]?.value ?? 0)),
        };
        insights.upsert({
          project_id: projectId, date: row.date_start, level, object_id: local.id, remote_id: remoteId,
          raw: JSON.stringify(row), ...metrics,
        });
        rows++;
        if (level === 'campaign') {
          totalSpend += metrics.spend;
          totalConversions += metrics.conversions;
        }
      }
    }
  }

  // 広告費を台帳に計上（重複計上を避けるため日付＋案件で1本にまとめる）
  if (totalSpend > 0) {
    ledger.add({
      project_id: projectId, date, kind: 'ad_spend', amount: -totalSpend,
      memo: `Meta広告費 ${date}`, ref_type: 'insights', ref_id: `${projectId}:${date}`,
    });
  }

  log.info('実績を取り込み', { projectId, date, rows, spend: totalSpend, conversions: totalConversions, sandbox: isSandbox() });
  return { projectId, date, rows, spend: totalSpend, conversions: totalConversions, sandbox: isSandbox() };
}

/** 直近 n 日をまとめて取り込む（初期構築・欠損補填用） */
export async function backfill(projectId: string, days: number): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const today = jstDateString();
  for (let i = days; i >= 1; i--) {
    results.push(await syncProject(projectId, addDays(today, -i)));
  }
  return results;
}
