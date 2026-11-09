import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, createRecorder } from '../db/index.js';
import { pendingMigrations, migrate, backupDb } from '../db/migrate.js';

// sales_count を追加する前の metrics の定義
const OLD_SCHEMA = `
CREATE TABLE divisions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', skill_name TEXT, weekly_goal TEXT, created_at TEXT NOT NULL DEFAULT 'x');
CREATE TABLE outputs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, division_id INTEGER NOT NULL, kind TEXT NOT NULL,
  file_path TEXT, preview_text TEXT, approval TEXT NOT NULL DEFAULT 'pending', published_url TEXT, created_at TEXT NOT NULL DEFAULT 'x', title TEXT, meta TEXT);
CREATE TABLE metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  division_id INTEGER NOT NULL REFERENCES divisions(id),
  name        TEXT NOT NULL CHECK (name IN
              ('revenue_jpy','impressions','clicks','followers','posts','work_minutes','api_cost_jpy')),
  value       REAL,
  output_id   INTEGER REFERENCES outputs(id)
);
CREATE UNIQUE INDEX uq_metrics ON metrics(date, division_id, name, IFNULL(output_id, 0));
INSERT INTO divisions (id, slug, name) VALUES (1, 'x-note', 'X＋note事業部');
INSERT INTO outputs (id, division_id, kind, approval) VALUES (7, 1, 'x_post', 'approved');
INSERT INTO metrics (id, date, division_id, name, value, output_id) VALUES
  (10, '2026-11-01', 1, 'revenue_jpy', 1500, NULL),
  (11, '2026-11-01', 1, 'impressions', NULL, NULL),
  (12, '2026-11-02', 1, 'impressions', 800, 7);
`;

function oldDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-company-mig-'));
  const file = path.join(dir, 'old.db');
  const db = new DatabaseSync(file);
  db.exec(OLD_SCHEMA);
  db.close();
  return file;
}

test('古い形式のDBは開くときに止めて、db:migrate を案内する', () => {
  assert.throws(() => openDb(oldDb()), /npm run db:migrate/);
});

test('移行: metrics を作り直してデータ（id・null・output_id）を保持し、sales_count を入れられる', () => {
  const file = oldDb();
  const db = openDb(file, { skipMigrationCheck: true });
  assert.deepEqual(pendingMigrations(db).length, 1);
  const backup = backupDb(db, file);
  assert.ok(fs.existsSync(backup));
  assert.equal(new DatabaseSync(backup).prepare('SELECT COUNT(*) c FROM metrics').get().c, 3);

  const done = migrate(db);
  assert.equal(done.length, 1);
  assert.deepEqual(pendingMigrations(db), []);
  assert.deepEqual(migrate(db), [], '2回目は何もしない');
  const rows = db.prepare('SELECT id, date, name, value, output_id FROM metrics ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 10, date: '2026-11-01', name: 'revenue_jpy', value: 1500, output_id: null },
    { id: 11, date: '2026-11-01', name: 'impressions', value: null, output_id: null },
    { id: 12, date: '2026-11-02', name: 'impressions', value: 800, output_id: 7 },
  ]);
  db.close();

  // 移行後は普通に開けて、sales_count を記録でき、一意インデックスも生きている
  const db2 = openDb(file);
  const rec = createRecorder(db2);
  rec.record_metric({ date: '2026-11-01', division: 'x-note', name: 'sales_count', value: 3 });
  assert.equal(db2.prepare("SELECT value FROM metrics WHERE name = 'sales_count'").get().value, 3);
  assert.throws(() => db2.prepare("INSERT INTO metrics (date, division_id, name, value) VALUES ('2026-11-01', 1, 'revenue_jpy', 1)").run(), /UNIQUE/);
  assert.throws(() => db2.prepare("INSERT INTO metrics (date, division_id, name, value) VALUES ('2026-11-03', 1, 'likes', 1)").run(), /CHECK/);
  assert.equal(db2.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('新しく作るDBは移行不要', () => {
  const db = openDb(':memory:');
  assert.deepEqual(pendingMigrations(db), []);
});
