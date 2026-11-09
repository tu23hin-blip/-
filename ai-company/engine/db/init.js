// DBを作成（既存DBなら最新の形式へ移行）し、engine/divisions/*/division.yaml の事業部を登録する。
//   npm run db:init
import { config } from '../config.js';
import { openDb, createRecorder } from './index.js';
import { pendingMigrations, backupDb, migrate } from './migrate.js';
import { syncDivisions } from '../registry.js';

const db = openDb(config.dbPath, { skipMigrationCheck: true });
if (pendingMigrations(db).length) {
  console.log(`バックアップ: ${backupDb(db, config.dbPath)}`);
  for (const d of migrate(db)) console.log(`✓ 移行: ${d}`);
}
const rec = createRecorder(db);
const configs = syncDivisions(rec);
console.log(`DB: ${config.dbPath}`);
console.log(`事業部を同期しました: ${configs.map((c) => c.slug).join(', ') || '(なし)'}`);
