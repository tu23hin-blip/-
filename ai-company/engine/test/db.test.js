import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createRecorder } from '../db/index.js';
import { dashboard, divisionsOverview, divisionDetail, inbox } from '../db/queries.js';
import { importMetricsCsv, parseCsv } from '../db/import-csv.js';
import { seed } from '../db/seed.js';
import { localDate, addDays, mondayOf } from '../config.js';

function fresh() {
  const db = openDb(':memory:');
  const rec = createRecorder(db);
  rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note', weekly_goal: { metric: 'impressions', target: 1000 } });
  return { db, rec };
}

test('タスクのライフサイクル: start → save_output(pending) → finish で承認待ちになり、events に記録される', () => {
  const { db, rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'X投稿案3本' });
  rec.log_event({ task_id: t, message: 'テーマ選定' });
  for (let i = 0; i < 3; i++) rec.save_output({ task_id: t, kind: 'x_post', preview_text: `post ${i}`, title: `#${i}` });
  assert.equal(rec.finish_task(t), 'awaiting_approval');
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(t);
  assert.equal(task.status, 'awaiting_approval');
  assert.ok(task.started_at && task.finished_at);
  const types = db.prepare('SELECT type FROM events WHERE task_id = ? ORDER BY id').all(t).map((e) => e.type);
  assert.deepEqual(types, ['start', 'progress', 'progress', 'progress', 'progress', 'finish']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM outputs WHERE approval = 'pending'").get().c, 3);
});

test('成果物がなければ finish で done', () => {
  const { rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'noop' });
  assert.equal(rec.finish_task(t), 'done');
});

test('fail_task はエラーを残し fail イベントを記録する', () => {
  const { db, rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  rec.fail_task(t, new Error('boom'));
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(t);
  assert.equal(task.status, 'failed');
  assert.equal(task.error, 'boom');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE task_id = ? AND type = 'fail'").get(t).c, 1);
});

test('承認・却下すると outputs と events が更新され、全部決まるとタスクは done', () => {
  const { db, rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const a = rec.save_output({ task_id: t, kind: 'x_post', title: 'a' });
  const b = rec.save_output({ task_id: t, kind: 'x_post', title: 'b' });
  rec.finish_task(t);
  rec.set_approval(a, 'approved');
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(t).status, 'awaiting_approval');
  rec.set_approval(b, 'rejected', { comment: '弱い' });
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(t).status, 'done');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'approval'").get().c, 2);
  assert.match(JSON.parse(db.prepare('SELECT meta FROM outputs WHERE id = ?').get(b).meta).comments[0].text, /弱い/);
});

test('修正コメントで修正タスクがキューに積まれる', () => {
  const { db, rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const a = rec.save_output({ task_id: t, kind: 'x_post', title: 'a' });
  rec.finish_task(t);
  const q = rec.request_revision(a, 'もっと短く');
  const qt = db.prepare('SELECT * FROM tasks WHERE id = ?').get(q);
  assert.equal(qt.status, 'queued');
  assert.equal(JSON.parse(qt.detail).revise_output_id, a);
  assert.throws(() => rec.request_revision(a, '  '));
});

test('投稿URLの登録は承認済みだけ。投稿数が1増える（2回目は増えない）', () => {
  const { db, rec } = fresh();
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const a = rec.save_output({ task_id: t, kind: 'x_post', title: 'a' });
  assert.throws(() => rec.set_published(a, 'https://x.com/1'));
  rec.set_approval(a, 'approved');
  rec.set_published(a, 'https://x.com/1');
  rec.set_published(a, 'https://x.com/1');
  assert.equal(db.prepare("SELECT value FROM metrics WHERE name = 'posts'").get().value, 1);
});

test('goal_update 提案は承認したときだけ weekly_goal を書き換える', () => {
  const { db, rec } = fresh();
  const meta = { type: 'goal_update', division_slug: 'x-note', new_goal: { metric: 'impressions', target: 5000 } };
  const a = rec.save_output({ division: 'x-note', kind: 'report', title: '目標更新案', meta });
  assert.equal(JSON.parse(db.prepare("SELECT weekly_goal g FROM divisions WHERE slug='x-note'").get().g).target, 1000);
  rec.set_approval(a, 'approved');
  assert.equal(JSON.parse(db.prepare("SELECT weekly_goal g FROM divisions WHERE slug='x-note'").get().g).target, 5000);
});

test('record_metric は上書き、null は不明として保存、不正値はエラー', () => {
  const { db, rec } = fresh();
  rec.record_metric({ date: '2026-01-01', division: 'x-note', name: 'impressions', value: 10 });
  rec.record_metric({ date: '2026-01-01', division: 'x-note', name: 'impressions', value: 20 });
  rec.record_metric({ date: '2026-01-02', division: 'x-note', name: 'impressions', value: null });
  const rows = db.prepare('SELECT date, value FROM metrics ORDER BY date').all();
  assert.deepEqual(rows.map((r) => [r.date, r.value]), [['2026-01-01', 20], ['2026-01-02', null]]);
  assert.throws(() => rec.record_metric({ division: 'x-note', name: 'likes', value: 1 }));
  assert.throws(() => rec.record_metric({ division: 'x-note', name: 'clicks', value: 'abc' }));
});

test('ダッシュボード: 数字がない日は null、0 の日は 0、利益 = 売上 − APIコスト', () => {
  const { db, rec } = fresh();
  const today = '2026-03-10';
  rec.record_metric({ date: '2026-03-08', division: 'x-note', name: 'revenue_jpy', value: 1000 });
  rec.record_metric({ date: '2026-03-08', division: 'x-note', name: 'api_cost_jpy', value: 100 });
  rec.record_metric({ date: '2026-03-09', division: 'x-note', name: 'revenue_jpy', value: 0 });
  rec.record_metric({ date: '2026-02-05', division: 'x-note', name: 'revenue_jpy', value: 500 });
  const d = dashboard(db, { days: 7, today });
  const by = Object.fromEntries(d.daily.map((x) => [x.date, x]));
  assert.equal(d.daily.length, 7);
  assert.equal(by['2026-03-08'].profit, 900);
  assert.equal(by['2026-03-09'].revenue, 0);
  assert.equal(by['2026-03-09'].profit, null); // コスト不明
  assert.equal(by['2026-03-10'].revenue, null);
  assert.equal(d.period.impressions, null);
  assert.equal(d.month.revenue, 1000);
  assert.equal(d.month.prev_revenue, 500);
  assert.equal(d.month.mom, 1);
});

test('ダッシュボード: 今週の目標と達成率', () => {
  const { db, rec } = fresh();
  const today = '2026-03-11'; // 水曜
  assert.equal(mondayOf(today), '2026-03-09');
  rec.record_metric({ date: '2026-03-08', division: 'x-note', name: 'impressions', value: 9999 }); // 先週
  rec.record_metric({ date: '2026-03-09', division: 'x-note', name: 'impressions', value: 300 });
  rec.record_metric({ date: '2026-03-10', division: 'x-note', name: 'impressions', value: 200 });
  const g = dashboard(db, { days: 7, today }).goals[0];
  assert.equal(g.actual, 500);
  assert.equal(g.rate, 0.5);
});

test('事業部ビュー: 状態ランプ（実行中/失敗/承認待ち/待機）', () => {
  const { db, rec } = fresh();
  const lamp = () => divisionsOverview(db)[0].lamp;
  assert.equal(lamp(), 'idle');
  const t = rec.start_task({ division: 'x-note', title: 'a' });
  assert.equal(lamp(), 'running');
  rec.save_output({ task_id: t, kind: 'x_post' });
  rec.finish_task(t);
  assert.equal(lamp(), 'awaiting');
  const t2 = rec.start_task({ division: 'x-note', title: 'b' });
  rec.fail_task(t2, 'x');
  assert.equal(lamp(), 'failed');
  const ov = divisionsOverview(db)[0];
  assert.equal(ov.pending, 1);
  assert.equal(ov.done_today, 1);
});

test('CSV取り込み: 正常系と、エラーがあれば1行も取り込まない', () => {
  const { db } = fresh();
  const ok = importMetricsCsv(db, 'date,division,name,value\n2026-01-01,x-note,impressions,"1,200"\n2026/01/02,X＋note事業部,revenue_jpy,\n');
  assert.deepEqual(ok, { imported: 2, errors: [] });
  assert.equal(db.prepare("SELECT value FROM metrics WHERE name='impressions'").get().value, 1200);
  assert.equal(db.prepare("SELECT value FROM metrics WHERE name='revenue_jpy'").get().value, null);
  const ng = importMetricsCsv(db, 'date,division,name,value\n2026-01-03,x-note,clicks,5\n2026-01-03,nope,clicks,5\n2026-13,x-note,likes,a\n');
  assert.equal(ng.imported, 0);
  assert.equal(ng.errors.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM metrics WHERE name='clicks'").get().c, 0);
  assert.deepEqual(parseCsv('a,"b,""c"""\r\n1,2'), [['a', 'b,"c"'], ['1', '2']]);
});

test('seed: 3事業部・30日分の metrics・承認待ち3件・各ランプ・週次レポート', () => {
  const db = openDb(':memory:');
  const today = localDate();
  seed(db, { today });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM divisions').get().c, 3);
  const dates = db.prepare('SELECT COUNT(DISTINCT date) c, MIN(date) mn FROM metrics').get();
  assert.equal(dates.c, 30);
  assert.equal(dates.mn, addDays(today, -29));
  const ov = Object.fromEntries(divisionsOverview(db).map((d) => [d.slug, d]));
  assert.equal(ov['x-note'].lamp, 'running');
  assert.equal(ov['x-note'].pending, 3);
  assert.equal(ov['short-video'].lamp, 'failed');
  assert.equal(ov['site-llmo'].lamp, 'idle');
  assert.equal(inbox(db).pending.length, 3);
  const d = dashboard(db, { days: 90, today });
  assert.ok(d.latest_report);
  assert.ok(d.seeded);
  assert.equal(d.daily.filter((x) => x.revenue === null).length >= 60, true); // 30日より前は空欄
  assert.ok(divisionDetail(db, 'x-note').events.length > 0);
});
