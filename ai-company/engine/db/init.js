// DBを作成し、engine/divisions/*/division.yaml の事業部を登録する。
//   npm run db:init
import { config } from '../config.js';
import { openDb, createRecorder } from './index.js';
import { syncDivisions } from '../registry.js';

const db = openDb();
const rec = createRecorder(db);
const configs = syncDivisions(rec);
console.log(`DB: ${config.dbPath}`);
console.log(`事業部を同期しました: ${configs.map((c) => c.slug).join(', ') || '(なし)'}`);
