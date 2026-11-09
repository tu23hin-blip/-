// 既存DBを最新の形式にする（データは保持。実行前にバックアップを作る）。
//   npm run db:migrate
import fs from 'node:fs';
import { config } from '../config.js';
import { openDb } from './index.js';
import { pendingMigrations, backupDb, migrate } from './migrate.js';

if (!fs.existsSync(config.dbPath)) {
  console.log(`DB がまだありません（${config.dbPath}）。npm run db:init で作成すると最新の形式になります。`);
  process.exit(0);
}
const db = openDb(config.dbPath, { skipMigrationCheck: true });
if (pendingMigrations(db).length === 0) {
  console.log('DB は最新の形式です。移行は不要です。');
  process.exit(0);
}
console.log(`バックアップ: ${backupDb(db, config.dbPath)}`);
for (const d of migrate(db)) console.log(`✓ ${d}`);
console.log('移行しました（データは保持しています）。画面（npm run web）を起動中なら再起動してください。');
