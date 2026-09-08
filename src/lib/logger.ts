type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

function emit(level: Level, scope: string, msg: string, meta?: unknown): void {
  if (order[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta !== undefined ? { meta } : {}),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

export type Logger = {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
};

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('app');
