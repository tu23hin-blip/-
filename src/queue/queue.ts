import { all, get, run, tx } from '../db/sqlite.ts';
import { newId } from '../lib/id.ts';
import { nowIso } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';

const log = createLogger('queue');

export type JobRow = {
  id: string;
  type: string;
  payload: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled';
  priority: number;
  run_at: string;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
};

export type EnqueueOptions = {
  priority?: number;
  runAt?: string | Date;
  maxAttempts?: number;
  /** 同一キーのジョブが未完了で存在すれば新規作成しない（多重起票の防止） */
  dedupeKey?: string;
};

export function enqueue(type: string, payload: unknown = {}, opts: EnqueueOptions = {}): string {
  const runAt = opts.runAt
    ? (opts.runAt instanceof Date ? opts.runAt.toISOString() : opts.runAt)
    : nowIso();
  const dedupe = opts.dedupeKey ?? null;

  return tx(() => {
    if (dedupe) {
      const existing = get<JobRow>(
        "SELECT * FROM jobs WHERE dedupe_key = ? AND status IN ('queued','running')",
        dedupe,
      );
      if (existing) {
        log.debug('重複ジョブのためスキップ', { type, dedupe, existing: existing.id });
        return existing.id;
      }
      // 完了済みの同キーは採番を空けるため退避
      run("UPDATE jobs SET dedupe_key = NULL WHERE dedupe_key = ?", dedupe);
    }
    const id = newId('job');
    const ts = nowIso();
    run(
      `INSERT INTO jobs (id, type, payload, status, priority, run_at, attempts, max_attempts, dedupe_key, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, type, JSON.stringify(payload ?? {}), 'queued', opts.priority ?? 5, runAt, 0,
      opts.maxAttempts ?? 3, dedupe, ts, ts,
    );
    log.debug('ジョブ登録', { id, type, runAt });
    return id;
  });
}

/** ワーカーが1件だけ排他的に取り出す（SQLite の即時トランザクションでロック） */
export function claim(workerId: string, types?: string[]): JobRow | undefined {
  return tx(() => {
    const typeFilter = types?.length ? `AND type IN (${types.map(() => '?').join(',')})` : '';
    const row = get<JobRow>(
      `SELECT * FROM jobs
        WHERE status = 'queued' AND run_at <= ? ${typeFilter}
        ORDER BY priority ASC, run_at ASC
        LIMIT 1`,
      nowIso(), ...(types ?? []),
    );
    if (!row) return undefined;
    run(
      `UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = 'queued'`,
      workerId, nowIso(), nowIso(), row.id,
    );
    return { ...row, status: 'running' as const, attempts: row.attempts + 1 };
  });
}

export function succeed(id: string, result?: unknown): void {
  run(
    "UPDATE jobs SET status = 'succeeded', result = ?, locked_by = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
    result === undefined ? null : JSON.stringify(result), nowIso(), id,
  );
}

/** 失敗時は指数バックオフで再投入。上限を超えたら dead に落として人手に回す。 */
export function fail(id: string, error: string): void {
  const job = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) return;
  if (job.attempts >= job.max_attempts) {
    run(
      "UPDATE jobs SET status = 'dead', last_error = ?, locked_by = NULL, updated_at = ? WHERE id = ?",
      error.slice(0, 4000), nowIso(), id,
    );
    log.error('ジョブが最大試行回数に到達', { id, type: job.type, error: error.slice(0, 300) });
    return;
  }
  const delayMs = Math.min(60_000 * 2 ** (job.attempts - 1), 30 * 60_000);
  const runAt = new Date(Date.now() + delayMs).toISOString();
  run(
    "UPDATE jobs SET status = 'queued', run_at = ?, last_error = ?, locked_by = NULL, updated_at = ? WHERE id = ?",
    runAt, error.slice(0, 4000), nowIso(), id,
  );
  log.warn('ジョブ再試行を予約', { id, type: job.type, attempts: job.attempts, runAt });
}

/** ワーカー異常終了で running のまま残ったジョブを回収する */
export function reapStale(olderThanMs = 30 * 60_000): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { changes } = run(
    "UPDATE jobs SET status = 'queued', locked_by = NULL, updated_at = ? WHERE status = 'running' AND locked_at < ?",
    nowIso(), cutoff,
  );
  if (changes > 0) log.warn('滞留ジョブを回収', { count: changes });
  return changes;
}

export const jobs = {
  find: (id: string) => get<JobRow>('SELECT * FROM jobs WHERE id = ?', id),
  list: (status?: string, limit = 100) =>
    status
      ? all<JobRow>('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?', status, limit)
      : all<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', limit),
  stats: () => all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status'),
  retry: (id: string) =>
    run("UPDATE jobs SET status = 'queued', run_at = ?, attempts = 0, last_error = NULL WHERE id = ?", nowIso(), id),
  cancel: (id: string) => run("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'queued'", id),
};
