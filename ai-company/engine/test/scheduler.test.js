import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setupEnv } from './helpers.js';

setupEnv({ DAILY_API_COST_LIMIT_JPY: '10' });
const { parseCron, cronMatches, nextRun } = await import('../scheduler/cron.js');
const { createScheduler, loadSchedule } = await import('../scheduler/scheduler.js');
const { getDb, createRecorder } = await import('../db/index.js');
const { runJob } = await import('../runner.js');
const { enforceCostLimit } = await import('../cost-guard.js');
const db = getDb();
const rec = createRecorder(db);

test('cron: 毎朝7時・月曜8時・範囲とステップ', () => {
  const at = (s) => new Date(s);
  assert.ok(cronMatches('0 7 * * *', at('2026-11-05T07:00:00')));
  assert.ok(!cronMatches('0 7 * * *', at('2026-11-05T07:01:00')));
  assert.ok(cronMatches('0 8 * * 1', at('2026-11-09T08:00:00')));   // 月曜
  assert.ok(!cronMatches('0 8 * * 1', at('2026-11-10T08:00:00')));
  assert.ok(cronMatches('*/15 9-10 * * 1-5', at('2026-11-05T10:45:00')));
  assert.ok(cronMatches('0 0 * * 7', at('2026-11-08T00:00:00')));  // 7 = 日曜
  assert.throws(() => parseCron('0 25 * * *'));
  assert.equal(nextRun('0 7 * * *', at('2026-11-05T07:00:30')).getDate(), 6);
});

test('schedule.yaml を読める（retry は最大1）', () => {
  const s = loadSchedule();
  assert.ok(s.jobs.some((j) => j.key === 'x-note:daily' && j.cron === '0 7 * * *'));
  assert.ok(s.jobs.some((j) => j.key === 'analyst:weekly' && j.cron === '0 8 * * 1'));
  assert.ok(s.retry <= 1);
});

// 偽の子プロセス: 指定コードで終了
function fakeSpawner(plan) {
  const started = [];
  const spawnJob = (job) => {
    const child = new EventEmitter();
    child.kill = () => child.emit('exit', 2);
    const codes = plan[job.key] || [0];
    const code = codes.length > 1 ? codes.shift() : codes[0];
    started.push({ key: job.key, at: Date.now() });
    setTimeout(() => child.emit('exit', code), 50);
    return child;
  };
  return { spawnJob, started };
}
const job = (division, j) => ({ division, job: j, key: `${division}:${j}`, parsed: parseCron('0 7 * * *') });
const waitIdle = async (s) => { while (s.running.size || s.pending.length) await new Promise((r) => setTimeout(r, 20)); };

test('違う事業部は並列、同じ事業部は待たせて二重起動しない', async () => {
  const { spawnJob, started } = fakeSpawner({});
  const s = createScheduler({ schedule: { retry: 1, retryDelayMs: 10, jobs: [] }, rec, spawnJob });
  s.launch(job('x-note', 'daily'));
  s.launch(job('analyst', 'weekly'));
  s.launch(job('x-note', 'weekly-note'));
  s.launch(job('x-note', 'weekly-note')); // 重複は1回だけ
  assert.equal(s.running.size, 2);         // x-note と analyst が同時に動いている
  assert.equal(s.pending.length, 1);
  await waitIdle(s);
  assert.deepEqual(started.map((x) => x.key), ['x-note:daily', 'analyst:weekly', 'x-note:weekly-note']);
});

test('失敗は1回だけリトライ。最後まで失敗したら events に fail', async () => {
  rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部' });
  const { spawnJob, started } = fakeSpawner({ 'x-note:daily': [2, 2, 2] });
  const s = createScheduler({ schedule: { retry: 1, retryDelayMs: 10, jobs: [] }, rec, spawnJob });
  s.launch(job('x-note', 'daily'));
  await new Promise((r) => setTimeout(r, 300));
  await waitIdle(s);
  assert.equal(started.length, 2);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'fail' AND message LIKE '%リトライ後も失敗%'").get().c >= 1);
});

test('リトライで成功すれば fail を出さない', async () => {
  const before = db.prepare("SELECT COUNT(*) c FROM events WHERE type='fail'").get().c;
  const { spawnJob, started } = fakeSpawner({ 'x-note:daily': [2, 0] });
  const s = createScheduler({ schedule: { retry: 1, retryDelayMs: 10, jobs: [] }, rec, spawnJob });
  s.launch(job('x-note', 'daily'));
  await new Promise((r) => setTimeout(r, 300));
  await waitIdle(s);
  assert.equal(started.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE type='fail'").get().c, before);
});

test('スリープ明け: 過ぎた予定を1回ずつ拾う', () => {
  const sched = { retry: 0, retryDelayMs: 0, jobs: [job('x-note', 'daily'), { ...job('analyst', 'weekly'), parsed: parseCron('0 8 * * 1') }] };
  const s = createScheduler({ schedule: sched, rec, spawnJob: () => new EventEmitter() });
  const due = s.dueBetween(new Date('2026-11-08T23:00:00'), new Date('2026-11-09T09:00:00'));
  assert.deepEqual(due.map((j) => j.key).sort(), ['analyst:weekly', 'x-note:daily']);
  assert.equal(s.dueBetween(new Date('2026-11-09T07:01:00'), new Date('2026-11-09T07:59:00')).length, 0);
});

test('APIコスト上限を超えたら全事業部を paused にし、以降の実行はスキップ', async () => {
  rec.ensure_division({ slug: 'analyst', name: '分析担当' });
  rec.set_division_status('x-note', 'active');
  // 1回目の実行で $0.05×150 = ¥7.5、2回目で ¥15 → 上限 ¥10 を超える
  assert.equal((await runJob('x-note', 'daily', { rec })).status, 'done');
  assert.equal((await runJob('x-note', 'daily', { rec })).status, 'done');
  const st = db.prepare('SELECT status FROM divisions').all().map((d) => d.status);
  assert.ok(st.every((x) => x === 'paused'), st.join());
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE division_id IS NULL AND message LIKE 'APIコスト上限超過%'").get().c >= 1);
  assert.equal((await runJob('x-note', 'daily', { rec, force: true })).reason, 'cost_limit');
  assert.equal(enforceCostLimit(rec), true);
});
