// 既存DBを最新の形式にする（データは保持）。
//   npm run db:migrate（実行は migrate-cli.js。ここは index.js からも読むライブラリ）
// いまの移行:
//   1. metrics.name の CHECK に sales_count（販売件数）を追加
//      SQLite は CHECK 制約を変更できないので、metrics テーブルを作り直してデータを移す。
// 実行前に engine/db/backups/ へバックアップ（VACUUM INTO）を作る。何度実行しても安全（必要なときだけ移行する）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

/** schema.sql から metrics テーブルと一意インデックスの定義を取り出す（定義を1か所にするため） */
function metricsDdl() {
  const table = SCHEMA.match(/CREATE TABLE IF NOT EXISTS metrics \([\s\S]*?\n\);/);
  const index = SCHEMA.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics[\s\S]*?;/);
  if (!table || !index) throw new Error('schema.sql から metrics の定義を読み取れません');
  return { table: table[0], index: index[0] };
}

function tableSql(db, name) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql ?? null;
}

/** 必要な移行の一覧（空なら最新） */
export function pendingMigrations(db) {
  const list = [];
  const sql = tableSql(db, 'metrics');
  if (sql && !sql.includes("'sales_count'")) list.push('metrics に指標 sales_count（販売件数）を追加');
  return list;
}

/** バックアップを作る。作ったファイルのパスを返す */
export function backupDb(db, dbPath) {
  if (!dbPath || dbPath === ':memory:') return null;
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const file = path.join(dir, `${path.basename(dbPath, '.db')}-${ts}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** 移行を実行する。実行した移行の説明を返す */
export function migrate(db) {
  const todo = pendingMigrations(db);
  if (todo.length === 0) return [];
  const { table, index } = metricsDdl();
  const cols = db.prepare('PRAGMA table_info(metrics)').all().map((c) => c.name);
  const outputCol = cols.includes('output_id') ? 'output_id' : 'NULL';
  const before = db.prepare('SELECT COUNT(*) c FROM metrics').get().c;

  // 外部キーの検査はテーブルの作り直し中だけ止める（トランザクションの外でしか切り替えられない）
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(table.replace('CREATE TABLE IF NOT EXISTS metrics (', 'CREATE TABLE metrics_new ('));
      db.exec(`INSERT INTO metrics_new (id, date, division_id, name, value, output_id)
        SELECT id, date, division_id, name, value, ${outputCol} FROM metrics`);
      db.exec('DROP TABLE metrics');
      db.exec('ALTER TABLE metrics_new RENAME TO metrics');
      db.exec(index);
      const after = db.prepare('SELECT COUNT(*) c FROM metrics').get().c;
      if (after !== before) throw new Error(`行数が一致しません（移行前 ${before} / 移行後 ${after}）`);
      const broken = db.prepare('PRAGMA foreign_key_check(metrics)').all();
      if (broken.length) throw new Error(`外部キーの不整合が ${broken.length} 件あります`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return todo;
}
