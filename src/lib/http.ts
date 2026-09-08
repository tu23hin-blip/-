import { upstream } from './errors.ts';
import { createLogger } from './logger.ts';

const log = createLogger('http');

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** 429/5xx のときに待つ基準ミリ秒（指数バックオフ） */
  backoffMs?: number;
  raw?: boolean;
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 外部API共通クライアント。
 * - 429 / 5xx は指数バックオフ + ジッタで再試行
 * - Retry-After ヘッダを尊重（Meta / OpenAI 双方が返す）
 * - 4xx（429以外）は即座に失敗させる（無駄な再試行をしない）
 */
export async function request<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 120_000,
    retries = 3,
    backoffMs = 800,
    raw = false,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (body !== undefined) {
        if (body instanceof FormData || typeof body === 'string' || body instanceof Uint8Array) {
          init.body = body as RequestInit['body'];
        } else {
          init.body = JSON.stringify(body);
          init.headers = { 'content-type': 'application/json', ...headers };
        }
      }
      const res = await fetch(url, init);

      if (res.ok) {
        if (raw) return (await res.arrayBuffer()) as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }

      const text = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) {
        throw upstream(`HTTP ${res.status} ${url}`, { status: res.status, body: text.slice(0, 2000) });
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoffMs * 2 ** attempt + Math.random() * 250;
      log.warn('リトライします', { url, status: res.status, attempt, waitMs: Math.round(wait) });
      await sleep(wait);
      lastError = upstream(`HTTP ${res.status}`, { body: text.slice(0, 500) });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = upstream(`タイムアウト: ${url}`);
      } else {
        lastError = err;
      }
      if (attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt + Math.random() * 250);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : upstream(`リクエスト失敗: ${url}`);
}

/** 非同期ジョブ完了待ち（動画生成APIのポーリング用） */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (v: T) => boolean,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 5_000;
  const timeout = opts.timeoutMs ?? 15 * 60_000;
  const deadline = Date.now() + timeout;
  let value = await fn();
  while (!isDone(value)) {
    if (Date.now() > deadline) throw upstream('生成ジョブがタイムアウトしました');
    await sleep(interval);
    value = await fn();
  }
  return value;
}
