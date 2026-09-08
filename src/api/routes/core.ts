import { get, patch, post, listRoutes } from '../server.ts';
import { requireRole, issueApiKey } from '../auth.ts';
import { advertisers, orgs, users } from '../../db/repositories/orgs.ts';
import { orderEvents, orders, projects } from '../../db/repositories/projects.ts';
import { assets, deliverables, pipelineRuns } from '../../db/repositories/production.ts';
import { events, notifications, settings } from '../../db/repositories/system.ts';
import { jobs } from '../../queue/queue.ts';
import { parseJson } from '../../db/sqlite.ts';
import { validate } from '../../lib/validate.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { save, pathFor, publicUrl } from '../../providers/storage/local.ts';
import { providerStatus } from '../../providers/registry.ts';
import { STATUS_LABELS, TRANSITIONS, autoAccept, transition } from '../../domain/workflow.ts';
import { dictionarySize } from '../../legal/scanner.ts';
import { enqueue } from '../../queue/queue.ts';
import type { Brief, OrderStatus, OrderType, PipelineStepRecord } from '../../domain/types.ts';

// ---------------- ヘルス・メタ情報 ----------------

get('/api/health', () => ({ ok: true, time: new Date().toISOString() }), { public: true });

get('/api/status', () => ({
  providers: providerStatus(),
  jobs: jobs.stats(),
  projects: projects.list().length,
  activeProjects: projects.active().length,
  legalRules: dictionarySize(),
  routes: listRoutes().length,
}));

get('/api/routes', () => listRoutes());

// ---------------- 組織・ユーザー・広告主 ----------------

get('/api/orgs', ({ query }) => orgs.list(query.get('kind') ?? undefined));

post('/api/orgs', ({ body, principal }) => {
  requireRole(principal, 'admin');
  const input = validate<{ kind: 'client' | 'agency' | 'media'; name: string }>(body, {
    kind: { type: 'string', required: true, enum: ['client', 'agency', 'media'] },
    name: { type: 'string', required: true, minLength: 1 },
    legal_name: { type: 'string' },
    invoice_no: { type: 'string', pattern: /^T\d{13}$/ },
    address: { type: 'string' },
    tel: { type: 'string' },
    contact_email: { type: 'string' },
    is_individual: { type: 'boolean', default: false },
    closing_day: { type: 'integer', min: 1, max: 31, default: 31 },
    payment_terms: { type: 'string', default: '翌月末' },
  });
  return orgs.create(input as never);
});

get('/api/users', ({ query }) => users.list(query.get('orgId') ?? undefined).map(({ api_key_hash, ...rest }) => rest));

post('/api/users', ({ body, principal }) => {
  requireRole(principal, 'admin');
  const input = validate<{ org_id: string; email: string; name: string; role: never }>(body, {
    org_id: { type: 'string', required: true },
    email: { type: 'string', required: true, pattern: /^[^@\s]+@[^@\s]+$/ },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['owner', 'admin', 'operator', 'legal', 'viewer'] },
  });
  const user = users.create(input);
  const key = issueApiKey(user.id);
  // APIキーはこの応答でしか返さない（以降は再発行のみ）
  return { ...user, api_key_hash: undefined, apiKey: key };
});

post('/api/users/:id/api-key', ({ params, principal }) => {
  requireRole(principal, 'admin');
  users.require(params['id']!);
  return { apiKey: issueApiKey(params['id']!) };
});

get('/api/advertisers', ({ query }) => advertisers.list(query.get('orgId') ?? undefined));

post('/api/advertisers', ({ body, principal }) => {
  requireRole(principal, 'operator');
  const input = validate<Record<string, unknown> & { org_id: string; name: string }>(body, {
    org_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    product_name: { type: 'string' },
    category: {
      type: 'string', default: 'general',
      enum: ['cosmetics', 'quasi_drug', 'drug', 'supplement', 'food_with_claims', 'medical_device', 'general'],
    },
    site_url: { type: 'string' },
    brand_guide: { type: 'string' },
  });
  const ngWords = Array.isArray(body['ng_words']) ? (body['ng_words'] as string[]) : [];
  return advertisers.create({ ...input, ng_words: JSON.stringify(ngWords) });
});

// ---------------- 案件 ----------------

get('/api/projects', ({ query }) => projects.list(query.get('status') ?? undefined));

post('/api/projects', ({ body, principal }) => {
  requireRole(principal, 'operator');
  const input = validate(body, {
    advertiser_id: { type: 'string', required: true },
    client_org_id: { type: 'string', required: true },
    agency_org_id: { type: 'string', required: true },
    media_org_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    objective: { type: 'string', default: 'conversions', enum: ['conversions', 'leads', 'traffic'] },
    monthly_budget: { type: 'integer', min: 0, default: 0 },
    daily_budget: { type: 'integer', min: 0, default: 0 },
    target_cpa: { type: 'integer', min: 0, default: 0 },
    target_roas: { type: 'number', min: 0, default: 0 },
    revenue_model: { type: 'string', default: 'fixed', enum: ['fixed', 'cpa', 'revshare'] },
    client_unit_price: { type: 'integer', min: 0, default: 0 },
    media_unit_price: { type: 'integer', min: 0, default: 0 },
    agency_margin_rate: { type: 'number', min: 0, max: 1, default: 0.2 },
    autopilot_level: { type: 'string', default: 'auto_safe', enum: ['off', 'suggest', 'auto_safe', 'auto_full'] },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
  });
  return projects.create(input as never);
});

get('/api/projects/:id', ({ params }) => {
  const project = projects.require(params['id']!);
  return {
    ...project,
    advertiser: advertisers.find(project.advertiser_id),
    client: orgs.find(project.client_org_id),
    agency: orgs.find(project.agency_org_id),
    media: orgs.find(project.media_org_id),
    orderCounts: orders.countByStatus(project.id),
  };
});

patch('/api/projects/:id', ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  const allowed = [
    'name', 'status', 'objective', 'monthly_budget', 'daily_budget', 'target_cpa', 'target_roas',
    'revenue_model', 'client_unit_price', 'media_unit_price', 'agency_margin_rate',
    'autopilot', 'autopilot_level', 'start_date', 'end_date',
  ];
  const fields = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  return projects.update(params['id']!, fields as never);
});

// ---------------- 発注 ----------------

get('/api/orders', ({ query }) =>
  orders.list({
    projectId: query.get('projectId') ?? undefined,
    status: (query.get('status') as OrderStatus) ?? undefined,
    type: query.get('type') ?? undefined,
    limit: Number(query.get('limit') ?? 100),
  }).map((o) => ({ ...o, statusLabel: STATUS_LABELS[o.status], brief: parseJson<Brief>(o.brief, {} as Brief) })));

/**
 * 発注の作成。autoAccept=true（既定）なら、そのまま制作パイプラインまで自走する。
 * これがクライアント/代理店から見た「依頼したものが上がってくる」入口。
 */
post('/api/orders', ({ body, principal }) => {
  requireRole(principal, 'operator');
  const input = validate<Record<string, unknown> & { project_id: string; type: OrderType; title: string }>(body, {
    project_id: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['video_ad', 'article_lp', 'lp', 'meta_operation'] },
    title: { type: 'string', required: true },
    quantity: { type: 'integer', min: 1, max: 20, default: 1 },
    priority: { type: 'integer', min: 1, max: 9, default: 5 },
    due_date: { type: 'string' },
    client_amount: { type: 'integer', min: 0, default: 0 },
    media_amount: { type: 'integer', min: 0, default: 0 },
  });
  const project = projects.require(input.project_id);
  const brief = (body['brief'] ?? {}) as Brief;
  if (typeof brief !== 'object' || Array.isArray(brief)) throw badRequest('brief はオブジェクトである必要があります');

  const order = orders.create({
    ...input,
    project_id: project.id,
    brief: JSON.stringify(brief),
    requested_by: principal.user?.email ?? 'api',
    client_amount: Number(body['client_amount'] ?? project.client_unit_price ?? 0),
    media_amount: Number(body['media_amount'] ?? project.media_unit_price ?? 0),
  });

  const shouldAutoAccept = body['autoAccept'] !== false;
  if (shouldAutoAccept) autoAccept(order.id, principal.user?.email ?? 'api');
  return { ...orders.require(order.id), autoAccepted: shouldAutoAccept };
});

get('/api/orders/:id', ({ params }) => {
  const order = orders.require(params['id']!);
  const run = pipelineRuns.latest(order.id);
  return {
    ...order,
    statusLabel: STATUS_LABELS[order.status],
    allowedTransitions: TRANSITIONS[order.status],
    brief: parseJson<Brief>(order.brief, {} as Brief),
    deliverables: deliverables.byOrder(order.id).map((d) => ({
      ...d,
      spec: parseJson(d.spec, {}),
      qc: parseJson(d.qc, {}),
      url: d.storage_path ? publicUrl(d.storage_path) : null,
      previewUrl: d.preview_path ? publicUrl(d.preview_path) : null,
      content: undefined,
    })),
    assets: assets.byOrder(order.id).map((a) => ({ ...a, url: publicUrl(a.storage_path) })),
    pipeline: run
      ? {
          id: run.id, pipeline: run.pipeline, status: run.status, currentStep: run.current_step,
          startedAt: run.started_at, finishedAt: run.finished_at, error: run.error,
          steps: parseJson<PipelineStepRecord[]>(run.steps, []),
        }
      : null,
    history: orderEvents.list(order.id),
  };
});

post('/api/orders/:id/transition', ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  const to = String(body['to'] ?? '') as OrderStatus;
  if (!to) throw badRequest('to は必須です');
  return transition(params['id']!, to, {
    actor: principal.user?.email ?? 'api',
    note: body['note'] ? String(body['note']) : undefined,
  });
});

post('/api/orders/:id/rerun', ({ params, principal }) => {
  requireRole(principal, 'operator');
  const order = orders.require(params['id']!);
  const jobId = enqueue('production.run', { orderId: order.id }, {
    priority: 2, dedupeKey: `production:${order.id}:manual:${Date.now()}`,
  });
  return { jobId, orderId: order.id };
});

// ---------------- 素材（提供素材のアップロード） ----------------

/**
 * クライアント提供素材の登録。
 * 動画の素材は「提供素材」か「AI生成」しか使わないため、
 * ここに登録されたものだけが提供素材としてパイプラインで参照できる。
 */
post('/api/assets', ({ body, principal }) => {
  requireRole(principal, 'operator');
  const input = validate<{ project_id: string; kind: never; filename: string; data: string }>(body, {
    project_id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['video', 'image', 'audio', 'font'] },
    filename: { type: 'string', required: true },
    data: { type: 'string', required: true },   // base64
    license_note: { type: 'string' },
  });
  projects.require(input.project_id);
  const buffer = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buffer.length === 0) throw badRequest('data が空です');

  const stored = save(
    pathFor({ projectId: input.project_id, kind: 'provided', name: input.filename }),
    new Uint8Array(buffer),
  );
  const asset = assets.create({
    project_id: input.project_id,
    source: 'client_provided',
    kind: input.kind,
    storage_path: stored.path,
    mime: stored.mime,
    bytes: stored.bytes,
    checksum: stored.checksum,
    license_note: String(body['license_note'] ?? 'クライアント提供素材'),
  });
  return { ...asset, url: publicUrl(asset.storage_path) };
});

get('/api/assets', ({ query }) => {
  const projectId = query.get('projectId');
  if (!projectId) throw badRequest('projectId は必須です');
  return assets.byProject(projectId).map((a) => ({ ...a, url: publicUrl(a.storage_path) }));
});

get('/api/deliverables/:id', ({ params }) => {
  const deliverable = deliverables.find(params['id']!);
  if (!deliverable) throw notFound('納品物が見つかりません');
  return {
    ...deliverable,
    spec: parseJson(deliverable.spec, {}),
    qc: parseJson(deliverable.qc, {}),
    url: deliverable.storage_path ? publicUrl(deliverable.storage_path) : null,
    previewUrl: deliverable.preview_path ? publicUrl(deliverable.preview_path) : null,
  };
});

// ---------------- ジョブ・監査ログ ----------------

get('/api/jobs', ({ query }) => jobs.list(query.get('status') ?? undefined, Number(query.get('limit') ?? 100)));

post('/api/jobs/:id/retry', ({ params, principal }) => {
  requireRole(principal, 'operator');
  jobs.retry(params['id']!);
  return jobs.find(params['id']!);
});

get('/api/events', ({ query }) => events.recent(Number(query.get('limit') ?? 100)));

get('/api/notifications', ({ query }) => notifications.recent(Number(query.get('limit') ?? 50)));

get('/api/settings', () => settings.all());

post('/api/settings', ({ body, principal }) => {
  requireRole(principal, 'admin');
  const key = String(body['key'] ?? '');
  const value = String(body['value'] ?? '');
  if (!key) throw badRequest('key は必須です');
  settings.set(key, value);
  return { key, value };
});
