import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exec, get, run } from './sqlite.ts';
import { nowIso } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';

const log = createLogger('migrate');
const here = dirname(fileURLToPath(import.meta.url));

/**
 * ベーススキーマ + 追記マイグレーション。
 * schema.sql は IF NOT EXISTS のみで構成されているため何度流しても安全。
 */
const migrations: { id: string; sql: string }[] = [
  // 追加のマイグレーションはここに push していく（例）:
  // { id: '2026-01-01-add-column', sql: 'ALTER TABLE projects ADD COLUMN foo TEXT' },
];

export function migrate(): void {
  exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  for (const m of migrations) {
    const applied = get<{ id: string }>('SELECT id FROM _migrations WHERE id = ?', m.id);
    if (applied) continue;
    exec(m.sql);
    run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', m.id, nowIso());
    log.info('マイグレーション適用', { id: m.id });
  }
  log.info('スキーマ最新化 完了');
}

if (import.meta.filename === process.argv[1]) {
  migrate();
}
