// オフィス画面: スタッフの状態・吹き出し・社長チャット・売上パネル、「今日の分を回す」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupEnv } from './helpers.js';

setupEnv();
const { openDb, createRecorder } = await import('../db/index.js');
const { office, staffState, staffActivity } = await import('../db/queries.js');
const { todaysJobs, startTodaysRun, scheduledOn } = await import('../scheduler/today.js');
const { parseCron } = await import('../scheduler/cron.js');
const { localDate, addDays } = await import('../config.js');

function fresh() {
  const db = openDb(':memory:');
  const rec = createRecorder(db);
  for (const [slug, name] of [['x-note', 'X＋note事業部'], ['short-video', 'ショート動画事業部'], ['site-llmo', '自サイト'], ['analyst', '分析担当'], ['metrics', '数字の取り込み']]) {
    rec.ensure_division({ slug, name, weekly_goal: slug === 'x-note' ? { metric: 'impressions', target: 1000 } : null });
  }
  return { db, rec };
}

test('スタッフの状態: 作業中／待機中／承認待ち／一時停止（席を外す）／失敗', () => {
  const base = { running: [], status: 'active', lamp: 'idle', pending: 0, last_task: null, last_event: null };
  assert.equal(staffState({ ...base, running: [{ title: 't' }] }), 'working');
  assert.equal(staffState({ ...base, running: [{ title: 't' }], status: 'paused' }), 'working', '実行中なら作業中を優先');
  assert.equal(staffState({ ...base, status: 'paused', lamp: 'failed' }), 'away');
  assert.equal(staffState({ ...base, lamp: 'failed' }), 'failed');
  assert.equal(staffState({ ...base, lamp: 'awaiting' }), 'awaiting');
  assert.equal(staffState(base), 'idle');
  assert.equal(staffActivity({ ...base, running: [{ title: 'X投稿案3本（2026-11-09）' }] }, 'working'), 'X投稿案3本を作業中', '日付は省く');
  assert.equal(staffActivity({ ...base, pending: 3 }, 'awaiting'), '承認待ちが 3 件あります');
  assert.match(staffActivity({ ...base, last_task: { error: 'X API のクレジットが切れています（402 CreditsDepleted）。X の開発者コンソールで…' } }, 'failed'), /^失敗: X API のクレジット.{0,40}…$/);
  assert.equal(Array.from(staffActivity({ ...base, last_task: { error: 'あ'.repeat(100) } }, 'failed')).length, 40, '吹き出しは1行（40字まで）');
  assert.equal(staffActivity(base, 'away'), '一時停止中（席を外しています）');
  assert.equal(staffActivity({ ...base, last_event: { message: '完了（承認待ち 3 件）' } }, 'idle'), '休憩中・前回: 完了（承認待ち 3 件）');
});

test('オフィスのデータ: 席・吹き出し・今月の投稿数・社長チャット（新しい順）・売上パネル・部門カード', () => {
  const { db, rec } = fresh();
  const today = localDate();
  // x-note: 作業中
  rec.start_task({ division: 'x-note', title: 'X投稿案3本' });
  // short-video: 一時停止
  rec.set_division_status('short-video', 'paused');
  // analyst: 承認待ち
  const t = rec.start_task({ division: 'analyst', title: '週次レポート' });
  rec.save_output({ task_id: t, kind: 'report', title: '目標の更新案' });
  rec.finish_task(t);
  // metrics: 失敗
  const f = rec.start_task({ division: 'metrics', title: 'X の取り込み' });
  rec.fail_task(f, 'X API のクレジットが切れています');
  rec.log_event({ message: '全社のお知らせ' });
  // 売上・件数・投稿数
  rec.record_sales({ division: 'x-note', date: today, revenue_jpy: 1500, sales_count: 3 });
  rec.record_sales({ division: 'site-llmo', date: today, revenue_jpy: 760, sales_count: 2 });
  rec.record_sales({ division: 'x-note', date: addDays(today, -1), revenue_jpy: 0, sales_count: 0 });
  rec.record_metric({ date: today, division: 'x-note', name: 'posts', value: 2 });

  const o = office(db, { today });
  const by = Object.fromEntries(o.staff.map((s) => [s.slug, s]));
  assert.deepEqual(Object.fromEntries(o.staff.map((s) => [s.slug, s.state])),
    { 'x-note': 'working', 'short-video': 'away', 'site-llmo': 'idle', analyst: 'awaiting', metrics: 'failed' });
  assert.equal(by['x-note'].activity, 'X投稿案3本を作業中');
  assert.ok(by['x-note'].running_since);
  assert.equal(by.analyst.pending, 1);
  assert.match(by.metrics.activity, /^失敗: X API のクレジット/);
  assert.ok(by.analyst.internal && by.metrics.internal && !by['x-note'].internal);
  assert.equal(by['x-note'].goal_label, 'インプレッション 1,000');
  assert.equal(o.month_posts, 2);
  // チャットは新しい順、全社のお知らせ（部門なし）も入る
  const ts = o.events.map((e) => e.created_at);
  assert.deepEqual(ts, [...ts].sort().reverse());
  assert.ok(o.events.some((e) => e.division_name === null && e.message === '全社のお知らせ'));
  // 売上パネル: 今月の累計・件数、明細（0円は出さない）
  // 前日の 0円 は月をまたぐ場合があるので、今日の分だけで確かめる
  assert.ok(o.sales.month_revenue >= 2260);
  assert.ok(o.sales.month_sales_count >= 5);
  assert.deepEqual(o.sales.recent.map((r) => [r.date, r.division_slug, r.amount, r.sales_count]).sort(),
    [[today, 'site-llmo', 760, 2], [today, 'x-note', 1500, 3]]);
});

const job = (division, j, cron, args = []) => ({ division, job: j, args, key: `${division}:${j}${args.length ? `:${args.join(',')}` : ''}`, parsed: parseCron(cron) });

test('今日の分: 今日に予定があるジョブだけ。一時停止中と今日実行済みは動かさない', () => {
  const { db, rec } = fresh();
  rec.ensure_division({ slug: 'materials', name: '材料づくり' });
  rec.set_division_status('short-video', 'paused');
  const thursday = '2026-11-12';
  const schedule = { jobs: [
    job('metrics', 'x', '0 6 * * *'),
    job('materials', 'research', '30 6 * * 1,4', ['x-note']),
    job('x-note', 'daily', '0 7 * * *'),
    job('x-note', 'weekly-note', '30 7 * * 6'),
    job('analyst', 'weekly', '0 8 * * 1'),
    job('analyst', 'midweek', '0 8 * * 4'),
    job('short-video', 'main', '0 9 * * *'),
  ] };
  assert.ok(scheduledOn(schedule.jobs[1], thursday));
  assert.ok(!scheduledOn(schedule.jobs[3], thursday));
  // 今日すでに x-note:daily が動いた（失敗した metrics:x はもう一度動かす）
  const realToday = localDate();
  const a = todaysJobs(db, { schedule, today: realToday });
  rec.start_task({ division: 'x-note', title: 'X投稿案3本', detail: { job: 'daily' } });
  const f = rec.start_task({ division: 'metrics', title: 'X', detail: { job: 'x' } });
  rec.fail_task(f, 'x');
  const b = todaysJobs(db, { schedule, today: realToday });
  assert.ok(a.run.some((j) => j.key === 'x-note:daily'));
  assert.ok(!b.run.some((j) => j.key === 'x-note:daily'));
  assert.ok(b.skipped.some((s) => s.key === 'x-note:daily' && s.reason === '今日は実行済み'));
  assert.ok(b.run.some((j) => j.key === 'metrics:x'), '失敗したものは動かす');
  assert.ok(b.skipped.some((s) => s.key === 'short-video:main' && s.reason === '一時停止中'));

  const thu = todaysJobs(db, { schedule, today: thursday });
  assert.deepEqual(thu.run.map((j) => j.key).sort(), ['analyst:midweek', 'materials:research:x-note', 'metrics:x', 'x-note:daily']);
});

test('「今日の分を回す」: scheduler --run-now をバックグラウンドで起動し、イベントに残す', () => {
  const { db, rec } = fresh();
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const schedule = { jobs: [job('x-note', 'daily', '0 7 * * *'), job('metrics', 'x', '0 6 * * *')] };
  const r = startTodaysRun(rec, { schedule, spawnImpl });
  assert.deepEqual(r.started, ['x-note:daily', 'metrics:x']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(-2), ['--run-now', 'x-note:daily,metrics:x']);
  assert.match(calls[0].args.at(-3), /engine\/scheduler\/scheduler\.js$/);
  assert.equal(calls[0].opts.detached, true);
  assert.ok(calls[0].opts.env.AI_COMPANY_ROOT.startsWith('/'), '子プロセスには絶対パスのルートを渡す');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE message LIKE '「今日の分を回す」: x-note:daily, metrics:x を開始しました%'").get().c === 1);
  // 全部一時停止なら何も起動しない
  rec.set_division_status('x-note', 'paused');
  rec.set_division_status('metrics', 'paused');
  const r2 = startTodaysRun(rec, { schedule, spawnImpl });
  assert.deepEqual(r2.started, []);
  assert.equal(calls.length, 1);
});

test('画面: オフィスのタブ・動きを減らす設定・承認待ちへの移動', () => {
  const header = fs.readFileSync(new URL('../../web/components/Header.js', import.meta.url), 'utf8');
  for (const t of ['経営ダッシュボード', '事業部ビュー', '承認待ち', 'オフィス']) assert.ok(header.includes(`label: '${t}'`), t);
  const css = fs.readFileSync(new URL('../../web/app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.staff \*, \.staff \{ animation: none !important; \}/);
  for (const s of ['working', 'idle', 'awaiting', 'failed', 'away']) assert.ok(css.includes(`.staff--${s}`), s);
  const page = fs.readFileSync(new URL('../../web/app/office/page.js', import.meta.url), 'utf8');
  assert.match(page, /\/inbox\?division=/);
  const inbox = fs.readFileSync(new URL('../../web/app/inbox/page.js', import.meta.url), 'utf8');
  assert.match(inbox, /get\('division'\)/);
});
