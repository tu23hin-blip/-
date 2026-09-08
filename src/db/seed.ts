import { migrate } from './migrate.ts';
import { advertisers, orgs, users } from './repositories/orgs.ts';
import { projects } from './repositories/projects.ts';
import { metaAccounts } from './repositories/meta.ts';
import { settings } from './repositories/system.ts';
import { issueApiKey } from '../api/auth.ts';
import { seedLegalRules } from '../legal/seed-rules.ts';
import { config } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { jstDateString } from '../lib/date.ts';

const log = createLogger('seed');

/**
 * 動作確認用のサンプルデータ。
 * ASP の三層（クライアント／代理店／メディア）と、薬機法の効く広告主カテゴリを含める。
 */
export function seed(): { projectId: string; apiKey: string } {
  migrate();
  seedLegalRules();

  const existing = settings.get('seed.project_id');
  if (existing) {
    log.info('既にシード済みです', { projectId: existing });
    return { projectId: existing, apiKey: '(既存。/api/users/:id/api-key で再発行できます)' };
  }

  const client = orgs.create({
    kind: 'client',
    name: 'ビューティコスメ株式会社',
    legal_name: 'ビューティコスメ株式会社',
    invoice_no: 'T9012345678901',
    address: '東京都港区南青山2-2-2',
    tel: '03-1111-2222',
    contact_email: 'ad@example-cosme.jp',
    payment_terms: '翌月末',
  });

  const agency = orgs.create({
    kind: 'agency',
    name: 'ノヴァ広告代理店株式会社',
    legal_name: 'ノヴァ広告代理店株式会社',
    invoice_no: 'T1234567890123',
    address: '東京都渋谷区神宮前1-1-1',
    tel: '03-3333-4444',
    contact_email: 'ops@example-agency.jp',
    payment_terms: '翌月末',
  });

  const media = orgs.create({
    kind: 'media',
    name: config.company.name,
    legal_name: config.company.name,
    invoice_no: config.company.invoiceNo,
    address: config.company.address,
    tel: config.company.tel,
    contact_email: 'media@example-media.jp',
    payment_terms: '翌月末',
  });

  const admin = users.create({
    org_id: media.id,
    email: 'admin@example-media.jp',
    name: '運用管理者',
    role: 'owner',
  });
  const apiKey = issueApiKey(admin.id);

  users.create({ org_id: media.id, email: 'legal@example-media.jp', name: '法務担当', role: 'legal' });
  users.create({ org_id: agency.id, email: 'ae@example-agency.jp', name: '代理店AE', role: 'operator' });

  const advertiser = advertisers.create({
    org_id: client.id,
    name: 'ビューティコスメ',
    product_name: 'モイストリペアセラム',
    category: 'cosmetics',
    site_url: 'https://example-cosme.jp/serum',
    brand_guide: '落ち着いた信頼感。過度な煽り表現は使わない。年齢を否定する表現は禁止。',
    ng_words: JSON.stringify(['奇跡', '劇的', '若返り']),
  });

  const project = projects.create({
    advertiser_id: advertiser.id,
    client_org_id: client.id,
    agency_org_id: agency.id,
    media_org_id: media.id,
    name: 'モイストリペアセラム 新規獲得',
    objective: 'conversions',
    monthly_budget: 3_000_000,
    daily_budget: 100_000,
    target_cpa: 6_000,
    target_roas: 2.5,
    revenue_model: 'cpa',
    client_unit_price: 8_000,
    media_unit_price: 6_000,
    agency_margin_rate: 0.25,
    autopilot: 1,
    autopilot_level: 'auto_safe',
    start_date: jstDateString(),
  });

  metaAccounts.create({
    project_id: project.id,
    ad_account_id: config.meta.defaultAdAccountId,
    page_id: config.meta.defaultPageId || 'sandbox_page',
    pixel_id: config.meta.defaultPixelId || 'sandbox_pixel',
  });

  settings.set('seed.project_id', project.id);
  settings.set('seed.admin_user_id', admin.id);

  log.info('サンプルデータを作成しました', {
    client: client.name, agency: agency.name, media: media.name, project: project.name,
  });
  return { projectId: project.id, apiKey };
}

if (import.meta.filename === process.argv[1]) {
  const result = seed();
  process.stdout.write(`\n案件ID: ${result.projectId}\nAPIキー: ${result.apiKey}\n\nダッシュボード: ${config.baseUrl}/\n\n`);
}
