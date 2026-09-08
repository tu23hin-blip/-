import { orderEvents, orders, projects } from '../db/repositories/projects.ts';
import { events, notifications } from '../db/repositories/system.ts';
import { enqueue } from '../queue/queue.ts';
import { conflict } from '../lib/errors.ts';
import { createLogger } from '../lib/logger.ts';
import type { Order, OrderStatus } from './types.ts';

const log = createLogger('workflow');

/**
 * 受注ライフサイクルの状態遷移表。
 * ここを唯一の真実にすることで、API・ワーカー・自動運用のどこから叩かれても
 * 不正な状態遷移が起きないようにする。
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  requested: ['accepted', 'rejected', 'cancelled'],
  accepted: ['in_production', 'cancelled'],
  in_production: ['internal_review', 'revision', 'cancelled'],
  internal_review: ['legal_review', 'revision', 'cancelled'],
  legal_review: ['client_review', 'revision', 'approved', 'cancelled'],
  revision: ['in_production', 'cancelled'],
  client_review: ['approved', 'revision', 'rejected'],
  approved: ['delivered', 'revision'],
  delivered: ['live', 'completed'],
  live: ['completed', 'revision'],
  completed: [],
  rejected: ['requested'],
  cancelled: [],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  requested: '依頼受付',
  accepted: '受注',
  in_production: '制作中',
  internal_review: '社内QC',
  legal_review: '法務チェック',
  revision: '差戻し・修正中',
  client_review: 'クライアント確認待ち',
  approved: '承認済',
  delivered: '納品済',
  live: '配信中',
  completed: '完了',
  rejected: '却下',
  cancelled: '取消',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export type TransitionOptions = {
  actor?: string;
  note?: string;
  /** 遷移に伴う自動処理（ジョブ投入）を抑止する */
  skipSideEffects?: boolean;
};

export function transition(orderId: string, to: OrderStatus, opts: TransitionOptions = {}): Order {
  const order = orders.require(orderId);
  const from = order.status;
  if (from === to) return order;
  if (!canTransition(from, to)) {
    throw conflict(
      `状態遷移が許可されていません: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }

  const actor = opts.actor ?? 'system';
  orders.update(orderId, { status: to });
  orderEvents.add(orderId, from, to, actor, opts.note);
  events.log(actor, 'order.transition', 'order', orderId, { from, to, note: opts.note });
  log.info('受注ステータス更新', { orderId, from, to, actor });

  if (!opts.skipSideEffects) applySideEffects({ ...order, status: to }, from);
  return orders.require(orderId);
}

/**
 * 状態遷移に紐づく自動処理。
 * 「依頼が来たら勝手に作り始め、できたら勝手に審査に回り、承認されたら勝手に入稿される」
 * という自走の連鎖はここで組んでいる。
 */
function applySideEffects(order: Order, from: OrderStatus): void {
  switch (order.status) {
    case 'accepted':
      // 受注したら即座に制作パイプラインを起動
      enqueue('production.run', { orderId: order.id }, {
        priority: order.priority,
        dedupeKey: `production:${order.id}`,
      });
      break;

    case 'internal_review':
      enqueue('production.qc', { orderId: order.id }, { dedupeKey: `qc:${order.id}` });
      break;

    case 'legal_review':
      enqueue('legal.review_order', { orderId: order.id }, { dedupeKey: `legal:${order.id}` });
      break;

    case 'revision':
      // 差戻しは自動で作り直す（回数上限はパイプライン側で制御）
      enqueue('production.run', { orderId: order.id, revision: true }, {
        priority: Math.max(1, order.priority - 1),
        dedupeKey: `production:${order.id}:rev:${Date.now()}`,
      });
      break;

    case 'approved':
      enqueue('delivery.finalize', { orderId: order.id }, { dedupeKey: `deliver:${order.id}` });
      break;

    case 'delivered': {
      const project = projects.find(order.project_id);
      // 承認済みクリエイティブは Meta へ自動入稿
      if (project && project.autopilot === 1 && order.type !== 'meta_operation') {
        enqueue('meta.publish_creative', { orderId: order.id }, {
          dedupeKey: `meta_publish:${order.id}`,
        });
      }
      break;
    }

    case 'rejected':
      notifications.create({
        project_id: order.project_id,
        level: 'warn',
        title: `受注が却下されました: ${order.title}`,
        body: `直前の状態: ${STATUS_LABELS[from]}`,
      });
      break;

    default:
      break;
  }
}

/** 依頼受付 → 受注 を自動で行う（メディア側の自走の入口） */
export function autoAccept(orderId: string, actor = 'autopilot'): Order {
  const order = orders.require(orderId);
  if (order.status !== 'requested') return order;
  return transition(orderId, 'accepted', { actor, note: '自動受注' });
}
