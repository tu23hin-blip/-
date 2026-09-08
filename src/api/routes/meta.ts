import { get, post } from '../server.ts';
import { requireRole } from '../auth.ts';
import { insights, metaAccounts, metaObjects, optimizerActions } from '../../db/repositories/meta.ts';
import { projects } from '../../db/repositories/projects.ts';
import { parseJson } from '../../db/sqlite.ts';
import { validate } from '../../lib/validate.ts';
import { addDays, jstDateString } from '../../lib/date.ts';
import { publishOrderCreatives, activate } from '../../meta/publisher.ts';
import { backfill, syncProject } from '../../meta/sync.ts';
import { aggregate, buildProposals, optimizeProject } from '../../meta/optimizer.ts';
import { isSandbox } from '../../meta/client.ts';

/** Meta 広告アカウントの接続 */
post('/api/projects/:id/meta/account', ({ params, body, principal }) => {
  requireRole(principal, 'admin');
  const projectId = params['id']!;
  projects.require(projectId);
  const input = validate<{ ad_account_id: string }>(body, {
    ad_account_id: { type: 'string', required: true, pattern: /^act_\d+$/ },
    page_id: { type: 'string' },
    pixel_id: { type: 'string' },
    instagram_id: { type: 'string' },
  });
  return metaAccounts.create({
    project_id: projectId,
    ad_account_id: input.ad_account_id,
    page_id: body['page_id'] ? String(body['page_id']) : undefined,
    pixel_id: body['pixel_id'] ? String(body['pixel_id']) : undefined,
    instagram_id: body['instagram_id'] ? String(body['instagram_id']) : undefined,
  });
});

get('/api/projects/:id/meta/objects', ({ params, query }) => {
  const level = query.get('level') as 'campaign' | 'adset' | 'ad' | 'creative' | null;
  return metaObjects.list(params['id']!, level ?? undefined).map((o) => ({
    ...o,
    config: parseJson(o.config, {}),
  }));
});

/** 承認済みクリエイティブを Meta へ入稿 */
post('/api/orders/:id/meta/publish', async ({ params, principal }) => {
  requireRole(principal, 'operator');
  return publishOrderCreatives(params['id']!);
});

/** 配信開始 */
post('/api/projects/:id/meta/activate', async ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  const ids = Array.isArray(body['objectIds']) ? (body['objectIds'] as string[]) : undefined;
  const count = await activate(params['id']!, ids);
  return { activated: count };
});

/** 実績の取り込み */
post('/api/projects/:id/meta/sync', async ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  const days = Number(body['days'] ?? 0);
  if (days > 0) return { results: await backfill(params['id']!, Math.min(90, days)) };
  return syncProject(params['id']!, body['date'] ? String(body['date']) : undefined);
});

/** 最適化の提案のみ取得（適用しない） */
get('/api/projects/:id/meta/proposals', ({ params, query }) =>
  buildProposals(params['id']!, query.get('date') ?? jstDateString()));

/** 最適化の実行（案件の autopilot_level に従って適用） */
post('/api/projects/:id/meta/optimize', async ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  return optimizeProject(params['id']!, body['date'] ? String(body['date']) : undefined);
});

/** 実績サマリー（ダッシュボード用） */
get('/api/projects/:id/insights', ({ params, query }) => {
  const projectId = params['id']!;
  const to = query.get('to') ?? jstDateString();
  const from = query.get('from') ?? addDays(to, -13);
  const level = query.get('level') ?? 'campaign';

  const rows = insights.range(projectId, from, to, level);
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return {
    projectId,
    from,
    to,
    sandbox: isSandbox(),
    total: aggregate(rows),
    daily: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, ...aggregate(list) })),
    byObject: metaObjects.list(projectId, 'ad').map((object) => ({
      id: object.id,
      name: object.name,
      status: object.status,
      deliverableId: object.deliverable_id,
      ...aggregate(insights.forObject(object.id, from, to)),
    })),
  };
});

get('/api/projects/:id/optimizer-actions', ({ params, query }) =>
  optimizerActions.recent(params['id']!, Number(query.get('limit') ?? 50)).map((a) => ({
    ...a,
    before: parseJson(a.before, {}),
    after: parseJson(a.after, {}),
  })));
