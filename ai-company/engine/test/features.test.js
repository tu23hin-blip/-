// 追加機能のテスト: 投稿ごとの数字／仮説の記録／アナリスト週2回／売上・販売件数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setupEnv, claudeCalls } from './helpers.js';

const dir = setupEnv();
process.env.KNOWLEDGE_DIR = path.join(dir, 'knowledge');
const { getDb, createRecorder, METRIC_NAMES } = await import('../db/index.js');
const { dashboard, inbox } = await import('../db/queries.js');
const { buildContext } = await import('../context.js');
const { runJob } = await import('../runner.js');
const { collectWeeklyData, periodsFor, renderReport } = await import('../divisions/analyst/run.js');
const { importMetricsCsv } = await import('../db/import-csv.js');
const { loadSchedule } = await import('../scheduler/scheduler.js');
const { localDate, addDays, config } = await import('../config.js');
const db = getDb();
const rec = createRecorder(db);
const today = localDate();
const yesterday = addDays(today, -1);
rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note', weekly_goal: { metric: 'impressions', target: 1000 } });
rec.ensure_division({ slug: 'analyst', name: '分析担当', skill_name: 'analyst' });

function approvedPost(title, hypothesis) {
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const id = rec.save_output({ task_id: t, kind: 'x_post', title, preview_text: title, meta: { theme: 'AIツール', hypothesis } });
  rec.finish_task(t);
  rec.set_approval(id, 'approved');
  return id;
}

// ---------- 1. 投稿ごとの数字 ----------
test('投稿ごとの数字（手入力）: 承認済みだけ、投稿ごとに1行（日付は投稿日）で上書き、空欄は変更しない', () => {
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const pending = rec.save_output({ task_id: t, kind: 'x_post', title: 'p' });
  assert.throws(() => rec.record_output_metrics(pending, { impressions: 10 }), /承認済み/);

  const id = approvedPost('投稿A', '【伸びた型】数字始まり');
  rec.record_output_metrics(id, { impressions: '1,200', clicks: 30 });
  rec.record_output_metrics(id, { impressions: 1500, clicks: '' }); // 同じ日は上書き、clicks は変更しない
  const rows = db.prepare('SELECT date, name, value, output_id FROM metrics WHERE output_id = ? ORDER BY name').all(id);
  assert.deepEqual(rows.map((r) => [r.date, r.name, r.value]), [[today, 'clicks', 30], [today, 'impressions', 1500]]);
  assert.throws(() => rec.record_output_metrics(id, {}), /どちらか/);
  assert.throws(() => rec.record_output_metrics(id, { impressions: -1 }), /0以上/);
  assert.throws(() => rec.record_output_metrics(id, { clicks: 1.5 }), /整数/);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE message LIKE '投稿の数字を手入力%'").get().c >= 2);
  // 事業部全体の数字（ダッシュボード）には混ざらない
  assert.equal(dashboard(db, { days: 7 }).period.impressions, null);
});

test('投稿ごとの数字は1行だけ: 何度入れても行は増えず、SUM しても二重に数えない（受け箱・コンテキスト）', () => {
  const id = approvedPost('投稿B', '【新仮説】1行目を問いかけにする');
  // 古い形式で日付違いの行が2つある投稿 → 1行にまとめて上書き
  rec.record_metric({ date: addDays(today, -2), division: 'x-note', name: 'impressions', value: 400, output_id: id });
  rec.record_metric({ date: addDays(today, -1), division: 'x-note', name: 'impressions', value: 600, output_id: id });
  rec.record_output_metrics(id, { impressions: 900 });
  rec.record_output_metrics(id, { impressions: 950 });
  const rows = db.prepare("SELECT date, value FROM metrics WHERE output_id = ? AND name = 'impressions'").all(id);
  assert.deepEqual(rows.map((r) => [r.date, r.value]), [[addDays(today, -2), 950]], '投稿日（最初の行の日付）で固定');
  const card = inbox(db).approved.find((o) => o.id === id);
  assert.equal(card.post_impressions, 950);
  const ctx = buildContext(db, rec.resolveDivision('x-note'), ['post_reactions']);
  assert.match(ctx, /仮説: 【新仮説】1行目を問いかけにする \/ インプ: 950/);
  assert.match(ctx, /仮説: 【伸びた型】数字始まり \/ インプ: 1500/);
  assert.ok(ctx.indexOf('インプ: 1500') < ctx.indexOf('インプ: 950'), 'インプレッション順');
});

// ---------- 2. 仮説の記録 ----------
test('仮説: Skill に記載があり、runner が meta.hypothesis に保存する（ない X投稿は警告）', async () => {
  const skill = fs.readFileSync(path.join(config.root, '.claude/skills/x-note/SKILL.md'), 'utf8');
  assert.match(skill, /3本のうち2本は直近で伸びた型、1本は新しい仮説を試す。各投稿の meta.hypothesis に何を試したかを1行で書く/);
  assert.match(skill, /"hypothesis"/);

  const r = await runJob('x-note', 'daily', { rec });
  assert.equal(r.status, 'done');
  const metas = db.prepare('SELECT meta FROM outputs WHERE task_id = ? ORDER BY id').all(r.taskId).map((o) => JSON.parse(o.meta));
  assert.deepEqual(metas.map((m) => m.hypothesis.match(/^【(.+?)】/)[1]), ['伸びた型', '伸びた型', '新仮説']);
  assert.ok(metas.every((m) => !m.warnings.some((w) => w.includes('仮説'))));
  // 直近の仮説がコンテキストに出る（承認後）
  assert.match(claudeCalls().at(-1).prompt, /仮説: 【/);

  process.env.FAKE_CLAUDE_MODE = 'nohyp';
  try {
    const r2 = await runJob('x-note', 'daily', { rec });
    const m2 = JSON.parse(db.prepare('SELECT meta FROM outputs WHERE task_id = ? LIMIT 1').get(r2.taskId).meta);
    assert.equal(m2.hypothesis, null);
    assert.ok(m2.warnings.some((w) => w.includes('仮説')));
  } finally { delete process.env.FAKE_CLAUDE_MODE; }
});

// ---------- 3. アナリスト週2回 ----------
test('midweek の期間: 直近7日（昨日まで）とその前7日', () => {
  assert.deepEqual(periodsFor('midweek', '2026-11-12'), { last: ['2026-11-05', '2026-11-11'], prev: ['2026-10-29', '2026-11-04'] });
  assert.deepEqual(periodsFor('weekly', '2026-11-09'), { last: ['2026-11-02', '2026-11-08'], prev: ['2026-10-26', '2026-11-01'] });
  const s = loadSchedule();
  assert.ok(s.jobs.some((j) => j.key === 'analyst:midweek' && j.cron === '0 8 * * 4'));
  assert.ok(s.jobs.some((j) => j.key === 'analyst:weekly' && j.cron === '0 8 * * 1'));
});

test('analyst midweek: 直近7日で集計し、weekly と同じ場所に保存、目標の変更案は承認待ち（同じ案は重ねない）', async () => {
  rec.record_metric({ date: yesterday, division: 'x-note', name: 'impressions', value: 700 });
  rec.record_metric({ date: addDays(today, -8), division: 'x-note', name: 'impressions', value: 350 });
  rec.record_metric({ date: today, division: 'x-note', name: 'impressions', value: 99999 }); // 今日は含めない
  const data = collectWeeklyData(db, today, 'midweek');
  const xn = data.divisions.find((d) => d.slug === 'x-note');
  assert.equal(xn.last_week.impressions.value, 700);
  assert.equal(xn.prev_week.impressions.value, 350);
  assert.match(renderReport(data, null), /# 中間レポート[\s\S]*\| インプレッション \| 700 \| 350 \| \+100\.0%/);

  const r = await runJob('analyst', 'midweek', { rec });
  assert.equal(r.status, 'done');
  assert.match(claudeCalls().at(-1).prompt, /ジョブ: midweek/);
  const name = `${today}-midweek.md`;
  assert.ok(fs.existsSync(path.join(dir, 'outputs', 'reports', name)));
  assert.ok(fs.existsSync(path.join(dir, 'knowledge', 'reports', name)));
  const rep = db.prepare("SELECT * FROM outputs WHERE json_extract(meta,'$.job') = 'midweek' AND json_extract(meta,'$.type') = 'weekly_report'").get();
  assert.equal(rep.approval, 'approved');
  assert.equal(dashboard(db, { days: 7 }).latest_report.id, rep.id);
  const props = () => db.prepare("SELECT * FROM outputs WHERE json_extract(meta,'$.type') = 'goal_update' AND approval = 'pending'").all();
  assert.equal(props().length, 1);
  assert.equal(JSON.parse(db.prepare("SELECT weekly_goal g FROM divisions WHERE slug='x-note'").get().g).target, 1000);
  await runJob('analyst', 'midweek', { rec });
  assert.equal(props().length, 1, '同じ変更案は承認待ちに重ねない');
});

// ---------- 4. 売上・販売件数 ----------
test('sales_count: 指標に追加され、CSV でも取り込める', () => {
  assert.ok(METRIC_NAMES.includes('sales_count'));
  const r = importMetricsCsv(db, `date,division,name,value\n${addDays(today, -20)},x-note,sales_count,3\n`);
  assert.deepEqual(r, { imported: 1, errors: [] });
});

test('売上・件数の入力: upsert・空欄は変更しない・検証', () => {
  const s1 = rec.record_sales({ division: 'x-note', date: yesterday, revenue_jpy: '¥3,000', sales_count: '6' });
  assert.deepEqual([s1.revenue_jpy, s1.sales_count], [3000, 6]);
  const s2 = rec.record_sales({ division: 'x-note', date: yesterday, revenue_jpy: '', sales_count: 5 });
  assert.deepEqual([s2.revenue_jpy, s2.sales_count], [3000, 5]);
  assert.deepEqual(rec.get_sales({ division: 'x-note', date: today }), { division: 'x-note', date: today, revenue_jpy: null, sales_count: null });
  assert.throws(() => rec.record_sales({ division: 'x-note', date: addDays(today, 1), revenue_jpy: 1 }), /未来/);
  assert.throws(() => rec.record_sales({ division: 'x-note', date: '2026/1/1', revenue_jpy: 1 }), /YYYY-MM-DD/);
  assert.throws(() => rec.record_sales({ division: 'x-note', date: yesterday }), /どちらか/);
  assert.throws(() => rec.record_sales({ division: 'x-note', date: yesterday, sales_count: 1.5 }), /整数/);
  assert.throws(() => rec.record_sales({ division: 'x-note', date: yesterday, revenue_jpy: -5 }), /0以上/);
  assert.throws(() => rec.record_sales({ division: 'nope', date: yesterday, revenue_jpy: 1 }), /見つかりません/);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE message LIKE '売上を入力%'").get().c >= 2);
});

test('ダッシュボード: 販売件数・平均単価（件数がある日だけ）・今週の件数・入力先の事業部', () => {
  const d0 = addDays(today, -2);
  rec.record_sales({ division: 'x-note', date: d0, revenue_jpy: 1000 }); // 件数なし → 平均単価に入れない
  const d = dashboard(db, { days: 7 });
  assert.equal(d.period.sales_count, 5);
  assert.equal(d.period.revenue_jpy, 4000);
  assert.equal(d.period.avg_unit_price, 600); // 3000 / 5（件数のない 1000円 は除外）
  assert.deepEqual(d.input_divisions.map((x) => x.slug), ['x-note']);
  const g = d.goals.find((x) => x.slug === 'x-note');
  assert.ok('week_sales_count' in g);
  assert.equal(dashboard(db, { days: 7, today: addDays(today, -30) }).period.avg_unit_price, null);
});

test('analyst の集計に sales_count と平均単価が入る', () => {
  const data = collectWeeklyData(db, today, 'midweek');
  const xn = data.divisions.find((d) => d.slug === 'x-note');
  assert.equal(xn.last_week.sales_count.value, 5);
  assert.equal(xn.avg_unit_price.last_week, 600);
  const md = renderReport(data, null);
  assert.match(md, /\| 販売件数 \| 5 \|/);
  assert.match(md, /\| 平均単価（売上÷件数） \| ¥600 \|/);
});

test('new-division: X投稿の事業部（例: sub-x）には仮説のルールが入る', async () => {
  const { hypothesisRule } = await import('../cli/new-division.js');
  assert.match(hypothesisRule({ kind: 'x_post', count: 3 }), /3本のうち2本は直近で伸びた型、1本は新しい仮説を試す。各投稿の meta.hypothesis に何を試したかを1行で書く/);
  assert.equal(hypothesisRule({ kind: 'script', count: 1 }), '');
  assert.ok(YAML.parse(fs.readFileSync(path.join(config.root, 'engine/divisions/analyst/division.yaml'), 'utf8')).jobs.midweek);
});
