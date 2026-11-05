// DBを空にする（ダミーデータを消して本番運用を始めるとき）。
//   npm run db:reset -- --yes
import fs from 'node:fs';
import { config } from '../config.js';
import { openDb, createRecorder } from './index.js';
import { syncDivisions } from '../registry.js';

if (!process.argv.includes('--yes')) {
  console.error(`DB（${config.dbPath}）の中身をすべて消します。よければ --yes を付けて実行してください。`);
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const f = config.dbPath + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}
const db = openDb();
const configs = syncDivisions(createRecorder(db));
console.log(`DBを初期化しました。登録した事業部: ${configs.map((c) => c.slug).join(', ') || '(なし)'}`);
