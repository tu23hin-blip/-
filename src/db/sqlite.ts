import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';

const log = createLogger('db');

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | Uint8Array | null;

let instance: DatabaseSync | null = null;

/** boolean / undefined / object を SQLite が受け取れる型に落とす */
function normalize(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'bigint' || typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    if (p instanceof Date) return p.toISOString();
    return JSON.stringify(p);
  });
}

export function db(): DatabaseSync {
  if (instance) return instance;
  const path = resolve(config.databasePath);
  mkdirSync(dirname(path), { recursive: true });
  instance = new DatabaseSync(path);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  instance.exec('PRAGMA synchronous = NORMAL;');
  log.debug('DB接続', { path });
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const res = db().prepare(sql).run(...normalize(params));
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...normalize(params)) as T | undefined;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...normalize(params)) as T[];
}

export function exec(sql: string): void {
  db().exec(sql);
}

/** 同期トランザクション。例外時は自動ロールバック。 */
export function tx<T>(fn: () => T): T {
  const handle = db();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      /* ロールバック自体の失敗は握りつぶす（元例外を優先） */
    }
    throw err;
  }
}

/** JSON カラムの安全な読み書き */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

/** UPDATE 文をフィールド集合から組み立てる（undefined は無視） */
export function buildUpdate(
  table: string,
  id: string,
  fields: Record<string, unknown>,
  idColumn = 'id',
): { changes: number } {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return { changes: 0 };
  const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
  const params = entries.map(([, v]) => v);
  return run(`UPDATE ${table} SET ${setSql} WHERE ${idColumn} = ?`, ...params, id);
}
