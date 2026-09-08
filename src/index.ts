import { config } from './config/env.ts';
import { migrate } from './db/migrate.ts';
import { closeDb } from './db/sqlite.ts';
import { createLogger } from './lib/logger.ts';
import { createApiServer, listRoutes } from './api/server.ts';
import { startWorker } from './queue/worker.ts';
import { startScheduler } from './queue/scheduler.ts';
import { providerStatus } from './providers/registry.ts';
import { seedLegalRules } from './legal/seed-rules.ts';

// ルート定義は import の副作用で登録される
import './api/routes/core.ts';
import './api/routes/meta.ts';
import './api/routes/legal.ts';
import './api/routes/reports.ts';
import './api/routes/web.ts';

const log = createLogger('main');

/**
 * 起動エントリ。既定では API・ワーカー・スケジューラを1プロセスで動かす。
 * 本番でスケールさせるときは --only=api / --only=worker で分離できる。
 */
async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const runApi = !only || only === 'api';
  const runWorker = !only || only === 'worker';
  const runScheduler = !only || only === 'worker' || only === 'scheduler';

  migrate();
  seedLegalRules();

  log.info('起動設定', {
    env: config.env,
    providers: providerStatus(),
    modes: { api: runApi, worker: runWorker, scheduler: runScheduler },
  });

  const stops: (() => void | Promise<void>)[] = [];

  if (runApi) {
    const server = createApiServer();
    await new Promise<void>((resolve) => server.listen(config.port, resolve));
    log.info(`APIを起動しました http://localhost:${config.port}`, { routes: listRoutes().length });
    stops.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  }

  if (runWorker) {
    const worker = startWorker({ concurrency: 2 });
    stops.push(() => worker.stop());
  }

  if (runScheduler) {
    const scheduler = startScheduler();
    stops.push(() => scheduler.stop());
  }

  const shutdown = async (signal: string) => {
    log.info('シャットダウンします', { signal });
    for (const stop of stops) await stop();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    log.error('起動に失敗しました', { error: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  });
}

export { main };
