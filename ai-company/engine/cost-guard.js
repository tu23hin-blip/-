// 1日のAPIコスト上限。超えたら全事業部を paused にする。
import { config, localDate } from './config.js';
import { todayApiCost } from './db/queries.js';

export const DEFAULT_USD_JPY = 150;

/** USD→円。USD_JPY_RATE 未設定なら 150円で概算し、そのことを返す */
export function usdToJpy(usd) {
  if (usd == null) return { jpy: null, assumed: false };
  const rate = config.usdJpyRate ?? DEFAULT_USD_JPY;
  return { jpy: Math.round(usd * rate * 100) / 100, assumed: config.usdJpyRate == null, rate };
}

/** 上限を超えていたら全事業部を一時停止して true を返す */
export function enforceCostLimit(rec, { limit = config.dailyCostLimitJpy } = {}) {
  if (limit == null || !Number.isFinite(limit)) return false;
  const spent = todayApiCost(rec.db, localDate());
  if (spent < limit) return false;
  const active = rec.db.prepare("SELECT slug FROM divisions WHERE status = 'active'").all();
  if (active.length === 0) return true;
  for (const d of active) rec.set_division_status(d.slug, 'paused', `今日のAPIコストが上限に達しました（¥${Math.round(spent)} / 上限 ¥${limit}）`);
  rec.log_event({ type: 'fail', message: `APIコスト上限超過: 今日 ¥${Math.round(spent)}（上限 ¥${limit}）。全事業部を一時停止しました。再開: npm run resume-all` });
  return true;
}
