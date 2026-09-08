import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { AppError } from '../lib/errors.ts';
import { createLogger } from '../lib/logger.ts';
import { absolute, guessMime, storageRoot } from '../providers/storage/local.ts';
import { authenticate, type Principal } from './auth.ts';

const log = createLogger('api');

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  principal: Principal;
};

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

type Route = {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
  /** 認証を必要としないエンドポイント（ヘルスチェック・公開ファイル） */
  public?: boolean;
};

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, opts: { public?: boolean } = {}): void {
  routes.push({
    method: method.toUpperCase(),
    pattern,
    segments: pattern.split('/').filter(Boolean),
    handler,
    public: opts.public,
  });
}

export const get = (p: string, h: Handler, o?: { public?: boolean }) => route('GET', p, h, o);
export const post = (p: string, h: Handler, o?: { public?: boolean }) => route('POST', p, h, o);
export const patch = (p: string, h: Handler, o?: { public?: boolean }) => route('PATCH', p, h, o);
export const del = (p: string, h: Handler, o?: { public?: boolean }) => route('DELETE', p, h, o);

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < candidate.segments.length; i++) {
      const expected = candidate.segments[i]!;
      const actual = segments[i]!;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // 素材の base64 アップロードを許容するため上限は大きめ
    if (size > 64 * 1024 * 1024) throw new AppError('payload_too_large', 'リクエストが大きすぎます', 413);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    throw new AppError('invalid_json', 'JSON の形式が不正です', 400);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined || body === null) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  if (typeof body === 'string') {
    const payload = Buffer.from(body, 'utf8');
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': payload.length, ...headers });
    res.end(payload);
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, ...headers });
  res.end(payload);
}

/** 生成物（動画・LP・レポート・請求書）を配信する静的ファイルハンドラ */
function serveFile(res: ServerResponse, relPath: string): boolean {
  let abs: string;
  try {
    abs = absolute(relPath);
  } catch {
    return false;
  }
  if (!abs.startsWith(storageRoot()) || !existsSync(abs) || !statSync(abs).isFile()) return false;
  const mime = extname(abs) === '.svg' ? 'image/svg+xml' : guessMime(abs);
  res.writeHead(200, {
    'content-type': mime,
    'content-length': statSync(abs).size,
    'cache-control': 'private, max-age=60',
  });
  createReadStream(abs).pipe(res);
  return true;
}

export function createApiServer() {
  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // CORS（管理画面を別ホストに置く構成に備える）
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type,authorization,x-api-key');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path.startsWith('/files/')) {
        const relPath = decodeURIComponent(path.slice('/files/'.length));
        if (serveFile(res, relPath)) return;
        send(res, 404, { error: 'not_found', message: 'ファイルが見つかりません' });
        return;
      }

      const found = match(req.method ?? 'GET', path);
      if (!found) {
        send(res, 404, { error: 'not_found', message: `${req.method} ${path} は存在しません` });
        return;
      }

      const principal = found.route.public
        ? ({ kind: 'bootstrap', role: 'viewer', orgId: null } as Principal)
        : authenticate(req.headers as Record<string, string | string[] | undefined>);

      const body = await readBody(req);
      const result = await found.route.handler({
        req, res, params: found.params, query: url.searchParams, body, principal,
      });

      if (res.writableEnded) return;
      if (typeof result === 'string') {
        send(res, 200, result);
      } else {
        send(res, result === undefined ? 204 : 200, result ?? null);
      }
    } catch (err) {
      const status = err instanceof AppError ? err.status : 500;
      const payload = err instanceof AppError
        ? { error: err.code, message: err.message, details: err.details }
        : { error: 'internal_error', message: err instanceof Error ? err.message : String(err) };
      if (status >= 500) {
        log.error('リクエスト処理でエラー', { path, error: payload.message, stack: err instanceof Error ? err.stack : undefined });
      }
      if (!res.writableEnded) send(res, status, payload);
    } finally {
      log.debug('リクエスト', { method: req.method, path, ms: Date.now() - started });
    }
  });
}

export function listRoutes(): { method: string; path: string }[] {
  return routes.map((r) => ({ method: r.method, path: r.pattern }));
}
