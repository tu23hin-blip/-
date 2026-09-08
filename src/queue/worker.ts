import { hostname } from 'node:os';
import { claim, fail, reapStale, succeed } from './queue.ts';
import { getHandler } from './handlers.ts';
import { createLogger } from '../lib/logger.ts';
import { events } from '../db/repositories/system.ts';

const log = createLogger('worker');

export type WorkerOptions = {
  concurrency?: number;
  pollIntervalMs?: number;
  types?: string[];
};

/**
 * ジョブワーカー。
 * SQLite の即時トランザクションで1件ずつ排他取得するので、
 * 同じDBを見る複数プロセスを立ち上げても二重実行にならない。
 */
export function startWorker(opts: WorkerOptions = {}): { stop: () => Promise<void> } {
  const concurrency = opts.concurrency ?? 2;
  const pollInterval = opts.pollIntervalMs ?? 2_000;
  const workerId = `${hostname()}-${process.pid}`;
  let running = true;
  const inFlight = new Set<Promise<void>>();

  log.info('ワーカー起動', { workerId, concurrency, types: opts.types ?? 'all' });

  async function processOne(): Promise<boolean> {
    const job = claim(workerId, opts.types);
    if (!job) return false;

    const handler = getHandler(job.type);
    if (!handler) {
      fail(job.id, `未登録のジョブ種別: ${job.type}`);
      return true;
    }

    const started = Date.now();
    try {
      const payload = JSON.parse(job.payload || '{}') as Record<string, unknown>;
      const result = await handler(payload);
      succeed(job.id, result);
      log.info('ジョブ完了', { id: job.id, type: job.type, ms: Date.now() - started });
      events.log('worker', 'job.succeeded', 'job', job.id, { type: job.type, ms: Date.now() - started });
    } catch (err) {
      const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      fail(job.id, message);
      log.error('ジョブ失敗', { id: job.id, type: job.type, error: message.slice(0, 500) });
      events.log('worker', 'job.failed', 'job', job.id, { type: job.type, error: message.slice(0, 500) });
    }
    return true;
  }

  async function loop(): Promise<void> {
    let idleTicks = 0;
    while (running) {
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
        continue;
      }
      const task = (async () => {
        const worked = await processOne();
        if (!worked) {
          idleTicks++;
          // 空振りが続いたら滞留ジョブを回収してから待つ
          if (idleTicks % 30 === 0) reapStale();
          await new Promise((r) => setTimeout(r, pollInterval));
        } else {
          idleTicks = 0;
        }
      })();
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
      // 取得の衝突を減らすためわずかにずらす
      await new Promise((r) => setTimeout(r, 25));
    }
    await Promise.allSettled([...inFlight]);
  }

  void loop();

  return {
    async stop() {
      running = false;
      await Promise.allSettled([...inFlight]);
      log.info('ワーカー停止', { workerId });
    },
  };
}
