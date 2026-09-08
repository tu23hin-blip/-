import { get, post } from '../server.ts';
import { requireRole } from '../auth.ts';
import { reports } from '../../db/repositories/system.ts';
import { parseJson } from '../../db/sqlite.ts';
import { publicUrl } from '../../providers/storage/local.ts';
import { generateAgencyReport, generateDailyReport } from '../../reports/daily.ts';
import { deliverReport } from '../../reports/delivery.ts';
import { jstDateString } from '../../lib/date.ts';

get('/api/reports', ({ query }) =>
  reports.list({
    projectId: query.get('projectId') ?? undefined,
    type: query.get('type') ?? undefined,
    limit: Number(query.get('limit') ?? 50),
  }).map((r) => ({ ...r, summary: parseJson(r.summary, {}) })));

get('/api/reports/:id', ({ params, query }) => {
  const report = reports.require(params['id']!);
  const format = query.get('format');
  if (format === 'html') return report.html ?? '<p>HTML が未生成です</p>';
  if (format === 'md') return report.markdown ?? '';
  return {
    ...report,
    summary: parseJson(report.summary, {}),
    url: report.storage_path ? publicUrl(report.storage_path) : null,
  };
});

/** 日次レポートを即時生成（配信も行う） */
post('/api/projects/:id/reports/daily', async ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  const date = body['date'] ? String(body['date']) : jstDateString(new Date(Date.now() - 86_400_000));
  const report = await generateDailyReport(params['id']!, date);
  const delivery = body['deliver'] === false ? { status: 'skipped' } : await deliverReport(report.id);
  return { ...report, html: undefined, markdown: undefined, summary: parseJson(report.summary, {}), delivery };
});

post('/api/reports/agency', async ({ body, principal }) => {
  requireRole(principal, 'operator');
  const report = await generateAgencyReport(body['date'] ? String(body['date']) : undefined);
  return { ...report, summary: parseJson(report.summary, {}) };
});

post('/api/reports/:id/deliver', async ({ params, body, principal }) => {
  requireRole(principal, 'operator');
  return deliverReport(params['id']!, body['channel'] as never);
});
