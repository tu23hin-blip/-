import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, claudeCalls } from './helpers.js';

const dir = setupEnv();
process.env.KNOWLEDGE_DIR = path.join(dir, 'knowledge');
const { getDb, createRecorder } = await import('../db/index.js');
const { runJob } = await import('../runner.js');
const { collectWeeklyData, renderReport } = await import('../divisions/analyst/run.js');
const { localDate, addDays, mondayOf } = await import('../config.js');
const { dashboard } = await import('../db/queries.js');
const db = getDb();
const rec = createRecorder(db);
rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note', weekly_goal: { metric: 'impressions', target: 25000 } });
const lastMon = addDays(mondayOf(localDate()), -7);
rec.record_metric({ date: lastMon, division: 'x-note', name: 'impressions', value: 1000 });
rec.record_metric({ date: addDays(lastMon, 1), division: 'x-note', name: 'impressions', value: 2000 });
rec.record_metric({ date: addDays(lastMon, -3), division: 'x-note', name: 'impressions', value: 1500 });

test('集計: 先週・前週・不足データ', () => {
  const d = collectWeeklyData(db).divisions.find((x) => x.slug === 'x-note');
  assert.equal(d.last_week.impressions.value, 3000);
  assert.equal(d.last_week.impressions.days_with_data, 2);
  assert.equal(d.prev_week.impressions.value, 1500);
  assert.equal(d.last_week.revenue_jpy.value, null);
  assert.ok(d.missing_inputs.some((m) => m.metric === 'revenue_jpy'));
  assert.ok(d.per_post_data_missing);
  const md = renderReport(collectWeeklyData(db), null);
  assert.match(md, /\+100\.0%/);
  assert.match(md, /入力してほしい数字/);
  assert.match(md, /不明/);
});

test('analyst weekly: レポートを2か所に保存し、目標更新案は承認待ち（weekly_goal は変わらない）', async () => {
  const r = await runJob('analyst', 'weekly', { rec });
  assert.equal(r.status, 'done');
  assert.equal(r.taskStatus, 'awaiting_approval');
  assert.ok(claudeCalls().at(-1).argv.includes('--agent'));
  const report = db.prepare("SELECT * FROM outputs WHERE json_extract(meta,'$.type') = 'weekly_report'").get();
  assert.equal(report.approval, 'approved');
  const name = path.basename(report.file_path);
  assert.ok(fs.existsSync(path.join(dir, 'outputs', 'reports', name)));
  assert.ok(fs.existsSync(path.join(dir, 'knowledge', 'reports', name)));
  const prop = db.prepare("SELECT * FROM outputs WHERE json_extract(meta,'$.type') = 'goal_update'").get();
  assert.equal(prop.approval, 'pending');
  assert.equal(JSON.parse(db.prepare("SELECT weekly_goal g FROM divisions WHERE slug='x-note'").get().g).target, 25000);
  rec.set_approval(prop.id, 'approved');
  assert.equal(JSON.parse(db.prepare("SELECT weekly_goal g FROM divisions WHERE slug='x-note'").get().g).target, 30000);
  // ダッシュボードの最新レポートと、分析担当が事業部比較に出ないこと
  const dash = dashboard(db, { days: 7 });
  assert.equal(dash.latest_report.id, report.id);
  assert.ok(!dash.goals.some((g) => g.slug === 'analyst'));
});
