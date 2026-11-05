// 共通設定。.env を読み込み、パスや上限値を決める。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* 古い Node では無視 */ }
}
if (!process.env.TZ) process.env.TZ = 'Asia/Tokyo';

const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  root: ROOT,
  dbPath: process.env.DB_PATH ? resolveFromRoot(process.env.DB_PATH) : path.join(ROOT, 'engine/db/ai-company.db'),
  outputsDir: path.join(ROOT, 'outputs'),
  knowledgeDir: path.join(ROOT, 'knowledge'),
  divisionsDir: path.join(ROOT, 'engine/divisions'),
  skillsDir: path.join(ROOT, '.claude/skills'),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || '',
  claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 15 * 60 * 1000),
  // 未設定なら null（上限なし）。数字の捏造を避けるため既定値は置かない
  dailyCostLimitJpy: process.env.DAILY_API_COST_LIMIT_JPY ? Number(process.env.DAILY_API_COST_LIMIT_JPY) : null,
  usdJpyRate: process.env.USD_JPY_RATE ? Number(process.env.USD_JPY_RATE) : null,
};

/** ローカル日付 YYYY-MM-DD */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD に n 日足す */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/** その日を含む週の月曜日 */
export function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 月=0
  return addDays(dateStr, -dow);
}
