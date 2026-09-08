import { orderEvents, orders, projects } from '../db/repositories/projects.ts';
import { deliverables } from '../db/repositories/production.ts';
import { legalReviews } from '../db/repositories/legal.ts';
import { advertisers } from '../db/repositories/orgs.ts';
import { notifications, reports as reportsRepo, events } from '../db/repositories/system.ts';
import { parseJson } from '../db/sqlite.ts';
import { jstDateString, nowIso } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';
import { transition } from '../domain/workflow.ts';
import { runVideoAdPipeline } from '../pipelines/video-ad.ts';
import { runArticleLpPipeline } from '../pipelines/article-lp.ts';
import { runLpPipeline } from '../pipelines/lp.ts';
import { check } from '../legal/checker.ts';
import { publishOrderCreatives, activate } from '../meta/publisher.ts';
import { syncProject } from '../meta/sync.ts';
import { optimizeProject } from '../meta/optimizer.ts';
import { generateAgencyReport, generateDailyReport } from '../reports/daily.ts';
import { deliverReport } from '../reports/delivery.ts';
import { buildInvoice, issueInvoice } from '../legal/invoices.ts';
import { enqueue } from './queue.ts';
import type { LegalFinding } from '../domain/types.ts';

const log = createLogger('worker:handlers');

export type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

/** 制作パイプラインの実行。type に応じて適切なパイプラインを選ぶ。 */
async function runProduction(payload: Record<string, unknown>): Promise<unknown> {
  const orderId = String(payload['orderId']);
  const order = orders.require(orderId);

  if (order.status !== 'in_production') {
    // accepted / revision から入ってくるので、まず制作中に遷移させる
    transition(orderId, 'in_production', { actor: 'worker', note: '制作開始', skipSideEffects: true });
  }

  const result = order.type === 'video_ad' ? await runVideoAdPipeline(orderId)
    : order.type === 'article_lp' ? await runArticleLpPipeline(orderId)
    : order.type === 'lp' ? await runLpPipeline(orderId)
    : null;

  if (!result) {
    // Meta運用の発注は制作物がないので、そのまま入稿・運用フェーズへ
    transition(orderId, 'internal_review', { actor: 'worker', note: '運用案件のため制作工程なし' });
    return { skipped: true };
  }

  if (result.status === 'failed') {
    notifications.create({
      project_id: order.project_id, level: 'critical',
      title: `制作パイプラインが失敗しました: ${order.title}`,
      body: result.error ?? '不明なエラー',
    });
    throw new Error(result.error ?? 'パイプライン失敗');
  }

  transition(orderId, 'internal_review', { actor: 'worker', note: `制作完了 (run=${result.runId})` });
  return { runId: result.runId, deliverables: deliverables.byOrder(orderId).length };
}

/** 社内QC。QC が通れば法務チェックへ、落ちれば差戻し。 */
async function runQc(payload: Record<string, unknown>): Promise<unknown> {
  const orderId = String(payload['orderId']);
  const order = orders.require(orderId);
  const list = deliverables.byOrder(orderId);

  const failed = list.filter((d) => {
    const qc = parseJson<{ passed?: boolean }>(d.qc, {});
    return qc.passed === false;
  });

  // 差戻しは無限ループしないよう2回までに制限する（履歴から実回数を数える）
  const revisions = orderEvents.list(orderId).filter((e) => (e as { to_state?: string }).to_state === 'revision').length;
  if (failed.length > 0 && revisions < 2 && failed.length === list.length) {
    transition(orderId, 'revision', { actor: 'qc', note: `QC不合格 ${failed.length}件` });
    return { passed: false, failed: failed.length };
  }

  transition(orderId, 'legal_review', { actor: 'qc', note: `QC完了（合格 ${list.length - failed.length}/${list.length}）` });
  return { passed: true, total: list.length, failed: failed.length };
}

/** 納品物単位の法務チェック。block が1件でもあれば人の確認に回す。 */
async function runLegalReview(payload: Record<string, unknown>): Promise<unknown> {
  const orderId = String(payload['orderId']);
  const order = orders.require(orderId);
  const project = projects.require(order.project_id);
  const advertiser = advertisers.require(project.advertiser_id);
  const list = deliverables.byOrder(orderId);

  let blocked = 0;
  for (const deliverable of list) {
    const text = deliverable.content ?? deliverable.title;
    const result = await check({
      text,
      category: advertiser.category,
      subjectType: 'deliverable',
      subjectId: deliverable.id,
      projectId: project.id,
      advertiserId: advertiser.id,
      deep: true,
      autoRevise: false,
    });
    deliverables.update(deliverable.id, { legal_status: result.status === 'pass' ? 'pass' : result.status });
    if (result.status === 'block') blocked++;
  }

  if (blocked > 0) {
    notifications.create({
      project_id: order.project_id, level: 'critical',
      title: `法務チェックで差し止めがあります: ${order.title}`,
      body: `${blocked}件の納品物に block 判定。法務担当の確認が必要です。`,
    });
    transition(orderId, 'client_review', { actor: 'legal', note: `block ${blocked}件のため人の確認へ` });
    return { blocked, total: list.length, escalated: true };
  }

  // 全て pass/warn なら自動承認（クライアント確認をスキップする設定の案件のみ）
  const autoApprove = project.autopilot === 1 && project.autopilot_level !== 'off';
  if (autoApprove) {
    transition(orderId, 'approved', { actor: 'legal', note: '法務チェック通過により自動承認' });
  } else {
    transition(orderId, 'client_review', { actor: 'legal', note: '法務チェック通過。クライアント確認待ち' });
  }
  return { blocked: 0, total: list.length, autoApproved: autoApprove };
}

/** 納品確定。納品物にタイムスタンプを打ち、発注を delivered にする。 */
async function finalizeDelivery(payload: Record<string, unknown>): Promise<unknown> {
  const orderId = String(payload['orderId']);
  const list = deliverables.byOrder(orderId);
  for (const deliverable of list) {
    if (deliverable.legal_status === 'block') continue;
    deliverables.update(deliverable.id, {
      status: 'delivered',
      approved_at: deliverable.approved_at ?? nowIso(),
      delivered_at: nowIso(),
    });
  }
  transition(orderId, 'delivered', { actor: 'worker', note: `納品 ${list.length}件` });
  return { delivered: list.length };
}

const handlers: Record<string, JobHandler> = {
  'production.run': runProduction,
  'production.qc': runQc,
  'legal.review_order': runLegalReview,
  'delivery.finalize': finalizeDelivery,

  /** 承認済みクリエイティブを Meta へ入稿 */
  'meta.publish_creative': async (payload) => {
    const orderId = String(payload['orderId']);
    const result = await publishOrderCreatives(orderId);
    const order = orders.require(orderId);
    const project = projects.require(order.project_id);

    if (project.autopilot === 1 && project.autopilot_level === 'auto_full' && result.adIds.length > 0) {
      await activate(project.id, result.adIds);
    }
    transition(orderId, 'live', { actor: 'worker', note: `Meta入稿 ${result.adIds.length}本` });
    return result;
  },

  /** 実績取り込み */
  'meta.sync': async (payload) => {
    const projectId = String(payload['projectId']);
    const date = payload['date'] ? String(payload['date']) : undefined;
    return syncProject(projectId, date);
  },

  /** 自動最適化 */
  'meta.optimize': async (payload) => {
    const projectId = String(payload['projectId']);
    const date = payload['date'] ? String(payload['date']) : undefined;
    const result = await optimizeProject(projectId, date);
    // 自動発注された案件はそのまま制作に流す
    for (const orderId of result.createdOrders) {
      enqueue('order.auto_accept', { orderId }, { dedupeKey: `auto_accept:${orderId}` });
    }
    return result;
  },

  'order.auto_accept': async (payload) => {
    const orderId = String(payload['orderId']);
    const { autoAccept } = await import('../domain/workflow.ts');
    const order = autoAccept(orderId);
    return { orderId, status: order.status };
  },

  /** 日次レポート生成 + 配信 */
  'report.daily': async (payload) => {
    const projectId = String(payload['projectId']);
    const date = payload['date'] ? String(payload['date']) : undefined;
    const report = await generateDailyReport(projectId, date);
    const delivery = await deliverReport(report.id);
    return { reportId: report.id, ...delivery };
  },

  'report.agency': async (payload) => {
    const date = payload['date'] ? String(payload['date']) : undefined;
    const report = await generateAgencyReport(date);
    return { reportId: report.id };
  },

  /** 月次請求書の自動作成 */
  'invoice.monthly': async (payload) => {
    const projectId = String(payload['projectId']);
    const periodFrom = String(payload['periodFrom']);
    const periodTo = String(payload['periodTo']);
    const receivable = buildInvoice({ projectId, direction: 'receivable', periodFrom, periodTo });
    const payable = buildInvoice({ projectId, direction: 'payable', periodFrom, periodTo });
    issueInvoice(receivable.id);
    issueInvoice(payable.id);
    return { receivable: receivable.invoice_no, payable: payable.invoice_no };
  },

  /** 通知の掃き出し（Slack など） */
  'notify.flush': async () => {
    const pending = notifications.pending(50);
    for (const item of pending) {
      notifications.markSent(item.id, 'sent');
    }
    return { flushed: pending.length };
  },

  /** 法務の再監査（配信中クリエイティブを定期的に見直す） */
  'legal.audit': async (payload) => {
    const projectId = String(payload['projectId']);
    const project = projects.require(projectId);
    const advertiser = advertisers.require(project.advertiser_id);
    const live = deliverables.approved(projectId).slice(0, 20);
    const results: { deliverableId: string; status: string; findings: number }[] = [];
    for (const deliverable of live) {
      const result = await check({
        text: deliverable.content ?? deliverable.title,
        category: advertiser.category,
        subjectType: 'deliverable',
        subjectId: deliverable.id,
        projectId,
        advertiserId: advertiser.id,
        deep: false,
      });
      if (result.status !== deliverable.legal_status) {
        deliverables.update(deliverable.id, { legal_status: result.status });
      }
      results.push({ deliverableId: deliverable.id, status: result.status, findings: result.findings.length });
    }
    const blocked = results.filter((r) => r.status === 'block');
    if (blocked.length) {
      notifications.create({
        project_id: projectId, level: 'critical',
        title: '配信中クリエイティブに法務リスクを検知',
        body: `${blocked.length}件が block 判定です。直ちに配信停止を検討してください。`,
      });
    }
    return { audited: results.length, blocked: blocked.length };
  },
};

export function getHandler(type: string): JobHandler | undefined {
  return handlers[type];
}

export function handlerTypes(): string[] {
  return Object.keys(handlers);
}

/** 法務レビューの指摘を人が読める形に整形（通知本文用） */
export function describeFindings(reviewId: string): string {
  const review = legalReviews.find(reviewId);
  if (!review) return '';
  const findings = parseJson<LegalFinding[]>(review.findings, []);
  return findings
    .slice(0, 10)
    .map((f) => `[${f.severity}] 「${f.phrase}」— ${f.reason}`)
    .join('\n');
}

export function todayJst(): string {
  return jstDateString();
}

export { events, reportsRepo };
