// 「今日の分を回す」: schedule.yaml のうち今日の日付に予定があるジョブを、今すぐ並列で1回ずつ動かす。
// ・一時停止中の部門は動かさない
// ・今日すでに動いた（失敗以外の）ジョブは動かさない（費用を二重にかけない）
// ・実行は scheduler.js --run-now に任せる（並列・二重起動の防止・リトライは定時実行と同じ）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, localDate } from '../config.js';
import { cronMatches } from './cron.js';
import { loadSchedule } from './scheduler.js';

const MINUTE = 60 * 1000;

/** その日のどこかの時刻に予定があるか */
export function scheduledOn(job, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 24 * 60; i++) if (cronMatches(job.parsed, new Date(start.getTime() + i * MINUTE))) return true;
  return false;
}

/** 今日すでに動いたか（tasks.detail.job と対象の部門で判断。失敗したものは「動いていない」扱い） */
function ranToday(db, job, today) {
  const rows = db.prepare(`SELECT t.detail, t.status, t.started_at FROM tasks t JOIN divisions d ON d.id = t.division_id
    WHERE d.slug = ? AND t.started_at IS NOT NULL AND t.status != 'failed' ORDER BY t.id DESC LIMIT 50`).all(job.division);
  return rows.some((r) => {
    if (localDate(new Date(r.started_at)) !== today) return false;
    let detail = {};
    try { detail = JSON.parse(r.detail || '{}'); } catch {}
    if (detail.job !== job.job) return false;
    return !job.args?.length || detail.division === job.args[0];
  });
}

/** 今日動かすジョブと、動かさない理由 */
export function todaysJobs(db, { schedule = loadSchedule(), today = localDate() } = {}) {
  const paused = new Set(db.prepare("SELECT slug FROM divisions WHERE status = 'paused'").all().map((r) => r.slug));
  const run = [], skipped = [];
  for (const job of schedule.jobs) {
    if (!scheduledOn(job, today)) continue;
    const target = job.args?.[0];
    if (paused.has(job.division) || (target && paused.has(target))) skipped.push({ key: job.key, reason: '一時停止中' });
    else if (ranToday(db, job, today)) skipped.push({ key: job.key, reason: '今日は実行済み' });
    else run.push(job);
  }
  return { run, skipped };
}

/** 今日の分をバックグラウンドで動かす。spawnImpl はテスト用 */
export function startTodaysRun(rec, { schedule, today, spawnImpl = spawn } = {}) {
  const { run, skipped } = todaysJobs(rec.db, { schedule, today });
  if (run.length === 0) {
    rec.log_event({ type: 'progress', message: `「今日の分を回す」: 動かすジョブはありません${skipped.length ? `（${skipped.map((s) => `${s.key}: ${s.reason}`).join(' / ')}）` : ''}` });
    return { started: [], skipped };
  }
  const keys = run.map((j) => j.key);
  const logDir = path.join(config.outputsDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `run-today-${today}.log`), 'a');
  const child = spawnImpl(process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(config.root, 'engine/scheduler/scheduler.js'), '--run-now', keys.join(',')],
    { cwd: config.root, env: { ...process.env, AI_COMPANY_ROOT: config.root }, detached: true, stdio: ['ignore', out, out] });
  child.unref?.();
  rec.log_event({ type: 'progress', message: `「今日の分を回す」: ${keys.join(', ')} を開始しました${skipped.length ? `（動かさない: ${skipped.map((s) => `${s.key}=${s.reason}`).join(' / ')}）` : ''}` });
  return { started: keys, skipped };
}
