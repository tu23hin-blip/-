// 定時実行スケジューラ（常駐）。schedule.yaml の時刻に事業部ジョブを子プロセスで起動する。
//   npm run scheduler                         … 常駐（Ctrl+C で停止）
//   npm run scheduler -- --run-now            … 全ジョブを今すぐ並列で1回実行して終了
//   npm run scheduler -- --run-now x-note:daily,analyst:weekly
//   npm run scheduler -- --list               … 次回の実行予定を表示
// ・違う事業部は並列、同じ事業部は二重起動しない（ここで防ぎ、さらに runner のロックでも防ぐ）
// ・失敗（終了コード2）は retry 回まで再実行（最大1）。最後まで失敗したら events に fail を記録
// ・終了コード4（クレジット切れ・キーの間違いなど直らない失敗）はリトライしない
// ・Mac のスリープ等で時刻を過ぎたジョブは、復帰時にまとめて1回ずつ実行する
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { config } from '../config.js';
import { getDb, createRecorder } from '../db/index.js';
import { loadDivisionConfig, syncDivisions } from '../registry.js';
import { parseCron, cronMatches, nextRun } from './cron.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_CLI = path.join(config.root, 'engine/cli/run.js');
const MINUTE = 60 * 1000;
const MAX_CATCHUP = 24 * 60 * MINUTE;

export function loadSchedule(file = process.env.SCHEDULE_FILE || path.join(HERE, 'schedule.yaml')) {
  const s = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const retry = Math.min(1, Math.max(0, Number(s.retry ?? 1)));
  const jobs = (s.jobs || []).map((j) => {
    const cfg = loadDivisionConfig(j.division);
    if (!fs.existsSync(path.join(cfg.dir, 'run.js')) && !cfg.jobs?.[j.job]) throw new Error(`schedule.yaml: ${j.division} にジョブ ${j.job} がありません`);
    const args = [].concat(j.args || []).map(String);
    return { ...j, args, key: `${j.division}:${j.job}${args.length ? `:${args.join(',')}` : ''}`, parsed: parseCron(j.cron) };
  });
  return { retry, retryDelayMs: Number(s.retry_delay_seconds ?? 60) * 1000, jobs };
}

const log = (...a) => console.log(new Date().toLocaleString('ja-JP'), ...a);

export function createScheduler({ schedule, rec, spawnJob = defaultSpawn }) {
  const running = new Map(); // division -> job key
  const pending = [];         // 同じ事業部が実行中で待っているもの（重複は入れない）
  const children = new Set();
  let stopping = false;

  function finish(job, attempt, code) {
    running.delete(job.division);
    if (code === 0) log(`✓ ${job.key} 完了`);
    else if (code === 3) log(`- ${job.key} スキップ（一時停止中・コスト上限・実行中のいずれか）`);
    else if (code === 4) {
      log(`✕ ${job.key} 失敗（リトライしても直らないエラー。リトライしません）`);
      if (!stopping) rec.log_event({ division: job.division, type: 'fail', message: `${job.key} が失敗しました（クレジット切れ・キーの間違いなど）。事業部ビューのエラーを確認してください。ほかのジョブはそのまま動きます` });
    }
    else if (attempt < schedule.retry && !stopping) {
      log(`✕ ${job.key} 失敗（code ${code}）→ ${Math.round(schedule.retryDelayMs / 1000)}秒後にリトライ`);
      rec.log_event({ division: job.division, type: 'progress', message: `${job.key} が失敗したため ${Math.round(schedule.retryDelayMs / 1000)}秒後にリトライします（${attempt + 1}/${schedule.retry}）` });
      setTimeout(() => launch(job, attempt + 1), schedule.retryDelayMs).unref?.();
    } else {
      log(`✕ ${job.key} 失敗（code ${code}）。リトライしません`);
      if (!stopping) rec.log_event({ division: job.division, type: 'fail', message: `${job.key} はリトライ後も失敗しました。事業部ビューのタスクのエラーを確認してください` });
    }
    const idx = pending.findIndex((p) => p.division === job.division);
    if (idx >= 0 && !stopping) launch(pending.splice(idx, 1)[0]);
  }

  function launch(job, attempt = 0) {
    if (stopping) return Promise.resolve();
    if (running.has(job.division)) {
      if (!pending.some((p) => p.key === job.key)) pending.push(job);
      log(`… ${job.key} は ${running.get(job.division)} の実行が終わるまで待機`);
      return Promise.resolve();
    }
    running.set(job.division, job.key);
    log(`▶ ${job.key} 開始${attempt ? '（リトライ）' : ''}`);
    return new Promise((resolve) => {
      const child = spawnJob(job);
      children.add(child);
      child.on('exit', (code) => { children.delete(child); finish(job, attempt, code ?? 2); resolve(code); });
    });
  }

  /** from〜to（分単位）の間に予定されていたジョブを返す（同じジョブは1回） */
  function dueBetween(from, to) {
    const due = new Map();
    const start = new Date(Math.max(from.getTime(), to.getTime() - MAX_CATCHUP));
    for (let t = new Date(start); t <= to; t = new Date(t.getTime() + MINUTE)) {
      for (const j of schedule.jobs) if (cronMatches(j.parsed, t) && !due.has(j.key)) due.set(j.key, j);
    }
    return [...due.values()];
  }

  async function stop() {
    stopping = true;
    for (const c of children) c.kill('SIGTERM');
    await new Promise((r) => { const check = () => (children.size ? setTimeout(check, 200) : r()); check(); });
  }

  return { launch, dueBetween, stop, running, pending, children };
}

function defaultSpawn(job) {
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', RUN_CLI, job.division, job.job, ...(job.args || [])],
    { cwd: config.root, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
}

async function main() {
  const rec = createRecorder(getDb());
  syncDivisions(rec);
  const schedule = loadSchedule();
  const argv = process.argv.slice(2);

  if (argv.includes('--list')) {
    for (const j of schedule.jobs) console.log(`${j.key.padEnd(24)} ${j.cron.padEnd(14)} 次回: ${nextRun(j.parsed)?.toLocaleString('ja-JP')}`);
    return;
  }

  const sch = createScheduler({ schedule, rec });
  const shutdown = async (sig) => {
    log(`${sig}: 停止します（実行中のジョブを止めています）…`);
    await sch.stop();
    rec.log_event({ type: 'progress', message: 'スケジューラを停止しました' });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const runNowIdx = argv.indexOf('--run-now');
  if (runNowIdx >= 0) {
    const sel = argv[runNowIdx + 1] && !argv[runNowIdx + 1].startsWith('--') ? argv[runNowIdx + 1].split(',') : null;
    const jobs = sel ? schedule.jobs.filter((j) => sel.includes(j.key)) : schedule.jobs;
    if (!jobs.length) throw new Error(`該当するジョブがありません: ${sel}`);
    log(`今すぐ実行: ${jobs.map((j) => j.key).join(', ')}`);
    await Promise.all(jobs.map((j) => sch.launch(j)));
    // リトライ・待機中のジョブが終わるまで待つ
    while (sch.running.size || sch.pending.length) await new Promise((r) => setTimeout(r, 500));
    return;
  }

  rec.log_event({ type: 'progress', message: `スケジューラを起動しました（${schedule.jobs.map((j) => `${j.key} ${j.cron}`).join(' / ')}）` });
  log('スケジューラ起動。Ctrl+C で停止');
  for (const j of schedule.jobs) log(`  ${j.key.padEnd(22)} ${j.cron.padEnd(14)} 次回 ${nextRun(j.parsed)?.toLocaleString('ja-JP')}`);
  let last = new Date(); last.setSeconds(0, 0);
  setInterval(() => {
    const now = new Date(); now.setSeconds(0, 0);
    if (now <= last) return;
    const from = new Date(last.getTime() + MINUTE);
    if (now - last > 2 * MINUTE) log(`スリープ等で ${Math.round((now - last) / MINUTE)} 分空きました。その間の予定を確認します`);
    for (const j of sch.dueBetween(from, now)) sch.launch(j);
    last = now;
  }, 15 * 1000);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    // 画面（事業部ビュー・オフィス）でも分かるように残す
    try { createRecorder(getDb()).log_event({ type: 'fail', message: `スケジューラを起動できませんでした: ${e.message}` }); } catch {}
    process.exit(1);
  });
}
