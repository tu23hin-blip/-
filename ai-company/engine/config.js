// 共通設定。.env を読み込み、パスや上限値を決める。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.AI_COMPANY_ROOT
  ? path.resolve(process.env.AI_COMPANY_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 子プロセス（スケジューラ・事業部の実行）が別のフォルダから起動しても同じ場所を指すよう、絶対パスにそろえる
if (process.env.AI_COMPANY_ROOT) process.env.AI_COMPANY_ROOT = ROOT;

const envFile = path.join(ROOT, '.env');
// テストでは .env（本物のAPIキー）を読まない
if (fs.existsSync(envFile) && !process.env.AI_COMPANY_SKIP_DOTENV) {
  try { process.loadEnvFile(envFile); } catch { /* 古い Node では無視 */ }
}
if (!process.env.TZ) process.env.TZ = 'Asia/Tokyo';

export function parseLimit(v) {
  if (v === undefined || String(v).trim() === '') return 200;
  if (/^(none|off|なし)$/i.test(String(v).trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  root: ROOT,
  dbPath: process.env.DB_PATH ? resolveFromRoot(process.env.DB_PATH) : path.join(ROOT, 'engine/db/ai-company.db'),
  outputsDir: process.env.OUTPUTS_DIR ? resolveFromRoot(process.env.OUTPUTS_DIR) : path.join(ROOT, 'outputs'),
  lockDir: process.env.LOCK_DIR ? resolveFromRoot(process.env.LOCK_DIR) : path.join(ROOT, 'engine/scheduler/locks'),
  knowledgeDir: process.env.KNOWLEDGE_DIR ? resolveFromRoot(process.env.KNOWLEDGE_DIR) : path.join(ROOT, 'knowledge'),
  divisionsDir: path.join(ROOT, 'engine/divisions'),
  skillsDir: path.join(ROOT, '.claude/skills'),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || '',
  claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 15 * 60 * 1000),
  // 1日のAPIコスト上限（円）。未設定なら 200円。上限をなくすときだけ none と書く
  dailyCostLimitJpy: parseLimit(process.env.DAILY_API_COST_LIMIT_JPY),
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
