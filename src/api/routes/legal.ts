import { get, post } from '../server.ts';
import { requireRole } from '../auth.ts';
import { legalReviews, legalRules } from '../../db/repositories/legal.ts';
import { advertisers } from '../../db/repositories/orgs.ts';
import { projects } from '../../db/repositories/projects.ts';
import { invoices as invoiceRepo, contracts as contractRepo, ledger } from '../../db/repositories/finance.ts';
import { parseJson } from '../../db/sqlite.ts';
import { validate } from '../../lib/validate.ts';
import { badRequest } from '../../lib/errors.ts';
import { addDays, endOfMonth, jstDateString } from '../../lib/date.ts';
import { publicUrl } from '../../providers/storage/local.ts';
import { check, toDto } from '../../legal/checker.ts';
import { DICTIONARY, CATEGORY_LABELS } from '../../legal/dictionary.ts';
import { CONTRACT_KINDS, generateContract, contractHtml } from '../../legal/contracts.ts';
import { buildInvoice, invoiceLines, issueInvoice, markPaid } from '../../legal/invoices.ts';
import type { AdvertiserCategory } from '../../domain/types.ts';

// ---------------- 薬機法・景表法チェック ----------------

/** 任意テキストの審査。入稿前チェックとして単体でも使える。 */
post('/api/legal/check', async ({ body, principal }) => {
  requireRole(principal, 'viewer');
  const input = validate<{ text: string; category: AdvertiserCategory }>(body, {
    text: { type: 'string', required: true, minLength: 1, maxLength: 100_000 },
    category: {
      type: 'string', default: 'general',
      enum: ['cosmetics', 'quasi_drug', 'drug', 'supplement', 'food_with_claims', 'medical_device', 'general'],
    },
    subjectType: { type: 'string', default: 'ad_copy', enum: ['script', 'article_lp', 'lp', 'ad_copy', 'deliverable', 'storyboard'] },
    deep: { type: 'boolean', default: true },
    autoRevise: { type: 'boolean', default: false },
  });
  return check({
    text: input.text,
    category: input.category,
    subjectType: (body['subjectType'] as never) ?? 'ad_copy',
    subjectId: body['subjectId'] ? String(body['subjectId']) : undefined,
    projectId: body['projectId'] ? String(body['projectId']) : undefined,
    advertiserId: body['advertiserId'] ? String(body['advertiserId']) : undefined,
    deep: body['deep'] !== false,
    autoRevise: body['autoRevise'] === true,
  });
});

get('/api/legal/reviews', ({ query }) => {
  const projectId = query.get('projectId');
  const list = projectId
    ? legalReviews.byProject(projectId, Number(query.get('limit') ?? 50))
    : legalReviews.recentBlocks(Number(query.get('limit') ?? 50));
  return list.map((r) => ({ ...toDto(r), original_text: undefined, revised_text: undefined }));
});

get('/api/legal/reviews/:id', ({ params }) => toDto(legalReviews.require(params['id']!)));

/** 組み込み辞書の一覧（何を根拠に弾いているかを開示する） */
get('/api/legal/dictionary', () => ({
  categories: CATEGORY_LABELS,
  entries: DICTIONARY.map((e) => ({
    id: e.id, law: e.law, pattern: e.pattern, isRegex: e.isRegex ?? false,
    categories: e.categories, allowedIn: e.allowedIn ?? [], severity: e.severity, reason: e.reason,
  })),
}));

get('/api/legal/rules', () => legalRules.list());

/** 広告主固有の禁止表現を追加する */
post('/api/legal/rules', ({ body, principal }) => {
  requireRole(principal, 'legal');
  const input = validate(body, {
    scope: { type: 'string', default: 'global' },
    law: { type: 'string', required: true, enum: ['yakkihou', 'keihyo', 'custom'] },
    pattern: { type: 'string', required: true, minLength: 1 },
    is_regex: { type: 'boolean', default: false },
    severity: { type: 'string', required: true, enum: ['block', 'warn', 'info'] },
    reason: { type: 'string', required: true },
    suggestion: { type: 'string' },
    category: { type: 'string' },
  });
  return legalRules.create({
    scope: String(input['scope'] ?? 'global'),
    law: input['law'] as 'yakkihou',
    category: input['category'] ? String(input['category']) : null,
    pattern: String(input['pattern']),
    is_regex: input['is_regex'] ? 1 : 0,
    severity: input['severity'] as 'block',
    reason: String(input['reason']),
    suggestion: input['suggestion'] ? String(input['suggestion']) : null,
    enabled: 1,
  });
});

// ---------------- 契約書 ----------------

get('/api/contracts', ({ query }) => contractRepo.list(query.get('projectId') ?? undefined).map((c) => ({
  ...c, body_md: undefined, variables: parseJson(c.variables, {}),
  url: c.storage_path ? publicUrl(c.storage_path) : null,
})));

post('/api/contracts', ({ body, principal }) => {
  requireRole(principal, 'admin');
  const input = validate(body, {
    kind: { type: 'string', required: true, enum: CONTRACT_KINDS },
    fromOrgId: { type: 'string', required: true },
    toOrgId: { type: 'string', required: true },
    projectId: { type: 'string' },
    title: { type: 'string' },
    effectiveDate: { type: 'string' },
  });
  return generateContract({
    kind: input['kind'] as 'master',
    fromOrgId: String(input['fromOrgId']),
    toOrgId: String(input['toOrgId']),
    projectId: input['projectId'] ? String(input['projectId']) : undefined,
    title: input['title'] ? String(input['title']) : undefined,
    effectiveDate: input['effectiveDate'] ? String(input['effectiveDate']) : undefined,
    variables: (body['variables'] as Record<string, string>) ?? {},
  });
});

get('/api/contracts/:id', ({ params, query }) => {
  const contract = contractRepo.require(params['id']!);
  if (query.get('format') === 'html') return contractHtml(contract.title, contract.body_md);
  return { ...contract, variables: parseJson(contract.variables, {}), url: contract.storage_path ? publicUrl(contract.storage_path) : null };
});

post('/api/contracts/:id/sign', ({ params, principal }) => {
  requireRole(principal, 'admin');
  return contractRepo.update(params['id']!, { status: 'signed', signed_at: new Date().toISOString() });
});

// ---------------- 請求書 ----------------

get('/api/invoices', ({ query }) =>
  invoiceRepo.list({
    projectId: query.get('projectId') ?? undefined,
    direction: query.get('direction') ?? undefined,
    status: query.get('status') ?? undefined,
  }).map((i) => ({ ...i, html: undefined, lines: invoiceLines(i), url: i.storage_path ? publicUrl(i.storage_path) : null })));

/**
 * 請求書の作成。明細を渡さなければ、対象期間の実績（成果・制作費・広告費）から自動で組み立てる。
 */
post('/api/invoices', ({ body, principal }) => {
  requireRole(principal, 'admin');
  const input = validate(body, {
    projectId: { type: 'string', required: true },
    direction: { type: 'string', required: true, enum: ['receivable', 'payable'] },
    periodFrom: { type: 'string' },
    periodTo: { type: 'string' },
    issueDate: { type: 'string' },
  });
  const today = jstDateString();
  const periodTo = String(input['periodTo'] ?? endOfMonth(addDays(today, -1)));
  const periodFrom = String(input['periodFrom'] ?? `${periodTo.slice(0, 7)}-01`);
  const lines = Array.isArray(body['lines']) ? (body['lines'] as never[]) : undefined;

  return buildInvoice({
    projectId: String(input['projectId']),
    direction: input['direction'] as 'receivable',
    periodFrom,
    periodTo,
    issueDate: input['issueDate'] ? String(input['issueDate']) : undefined,
    lines,
    notes: body['notes'] ? String(body['notes']) : undefined,
  });
});

get('/api/invoices/:id', ({ params, query }) => {
  const invoice = invoiceRepo.require(params['id']!);
  if (query.get('format') === 'html') return invoice.html ?? '';
  return { ...invoice, html: undefined, lines: invoiceLines(invoice), url: invoice.storage_path ? publicUrl(invoice.storage_path) : null };
});

post('/api/invoices/:id/issue', ({ params, principal }) => {
  requireRole(principal, 'admin');
  return issueInvoice(params['id']!);
});

post('/api/invoices/:id/paid', ({ params, body, principal }) => {
  requireRole(principal, 'admin');
  return markPaid(params['id']!, body['paidAt'] ? String(body['paidAt']) : undefined);
});

/** 収支（ASP三層のお金の流れ） */
get('/api/projects/:id/ledger', ({ params, query }) => {
  const projectId = params['id']!;
  const project = projects.require(projectId);
  const to = query.get('to') ?? jstDateString();
  const from = query.get('from') ?? `${to.slice(0, 7)}-01`;
  const totals = ledger.totals(projectId, from, to);
  const map = Object.fromEntries(totals.map((t) => [t.kind, t.total]));
  const revenue = map['client_revenue'] ?? 0;
  const mediaCost = Math.abs(map['media_cost'] ?? 0);
  const adSpend = Math.abs(map['ad_spend'] ?? 0);

  return {
    projectId,
    period: { from, to },
    revenueModel: project.revenue_model,
    clientRevenue: revenue,
    mediaCost,
    adSpend,
    agencyMargin: revenue - mediaCost,
    mediaProfit: mediaCost - adSpend,
    entries: ledger.range(projectId, from, to),
  };
});

get('/api/advertisers/:id/legal-profile', ({ params }) => {
  const advertiser = advertisers.require(params['id']!);
  return {
    advertiserId: advertiser.id,
    category: advertiser.category,
    categoryLabel: CATEGORY_LABELS[advertiser.category],
    ngWords: parseJson<string[]>(advertiser.ng_words, []),
    applicableRules: DICTIONARY.filter(
      (e) => (e.categories === 'all' || e.categories.includes(advertiser.category)) && !e.allowedIn?.includes(advertiser.category),
    ).length,
  };
});

get('/api/legal/summary', ({ query }) => {
  const projectId = query.get('projectId');
  if (!projectId) throw badRequest('projectId は必須です');
  const list = legalReviews.byProject(projectId, 200);
  return {
    total: list.length,
    pass: list.filter((r) => r.status === 'pass').length,
    warn: list.filter((r) => r.status === 'warn').length,
    block: list.filter((r) => r.status === 'block').length,
    averageScore: list.length ? Math.round(list.reduce((s, r) => s + r.score, 0) / list.length) : 100,
  };
});
