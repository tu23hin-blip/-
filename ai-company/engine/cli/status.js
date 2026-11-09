// 事業部の状態を一括で変える／確認する。
//   npm run pause-all   … 全事業部を一時停止
//   npm run resume-all  … 全事業部を再開（APIコスト上限で止まったあとなど）
//   npm run pause -- short-video   … 1つの事業部を一時停止
//   npm run resume -- short-video  … 1つの事業部を再開
//   node engine/cli/status.js list
import { getDb, createRecorder } from '../db/index.js';
import { todayApiCost } from '../db/queries.js';
import { config } from '../config.js';

const rec = createRecorder(getDb());
const cmd = process.argv[2] || 'list';
const rows = rec.db.prepare('SELECT slug, name, status FROM divisions ORDER BY id').all();
if (cmd === 'pause' || cmd === 'resume') {
  const slug = process.argv[3];
  if (!slug) { console.error(`使い方: npm run ${cmd} -- <事業部slug>`); process.exit(1); }
  rec.set_division_status(slug, cmd === 'pause' ? 'paused' : 'active', cmd === 'pause' ? 'コマンドで一時停止' : 'コマンドで再開');
}
if (cmd === 'pause-all' || cmd === 'resume-all') {
  const to = cmd === 'pause-all' ? 'paused' : 'active';
  for (const d of rows) if (d.status !== to) rec.set_division_status(d.slug, to, cmd === 'pause-all' ? 'コマンドで一括停止' : 'コマンドで一括再開');
  if (to === 'active' && config.dailyCostLimitJpy != null && todayApiCost(rec.db) >= config.dailyCostLimitJpy) {
    console.warn(`注意: 今日のAPIコストはすでに上限（¥${config.dailyCostLimitJpy}）以上です。次の実行でまた一時停止されます。`);
  }
}
for (const d of rec.db.prepare('SELECT slug, name, status FROM divisions ORDER BY id').all()) console.log(`${d.status === 'active' ? '●' : '○'} ${d.slug.padEnd(14)} ${d.status.padEnd(7)} ${d.name}`);
console.log(`今日のAPIコスト: ¥${Math.round(todayApiCost(rec.db))}${config.dailyCostLimitJpy != null ? ` / 上限 ¥${config.dailyCostLimitJpy}` : '（上限未設定）'}`);
