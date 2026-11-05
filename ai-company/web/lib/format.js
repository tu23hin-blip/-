// 表示用の整形。null は「—」（0 と区別する）
export const DASH = '—';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmtNum = (v) => (isNum(v) ? Math.round(v).toLocaleString('ja-JP') : DASH);
export const fmtYen = (v) => (isNum(v) ? `¥${Math.round(v).toLocaleString('ja-JP')}` : DASH);
export const fmtPct = (v, sign = false) => (isNum(v) ? `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : DASH);
export const fmtMinutes = (v) => {
  if (!isNum(v)) return DASH;
  const h = Math.floor(v / 60), m = Math.round(v % 60);
  return h ? `${h}時間${m}分` : `${m}分`;
};
export const fmtDate = (d) => (d ? d.slice(5).replace('-', '/') : DASH);
export function fmtTime(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return same ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
export function fmtElapsed(fromIso, now = Date.now()) {
  if (!fromIso) return DASH;
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}時間${m}分` : m ? `${m}分${sec}秒` : `${sec}秒`;
}
export const LAMP_LABEL = { running: '実行中', awaiting: '承認待ち', failed: '失敗', idle: '待機' };
export const TASK_STATUS_LABEL = { running: '実行中', queued: '待機中', awaiting_approval: '承認待ち', failed: '失敗', done: '完了' };
export const KIND_LABEL = { x_post: 'X投稿', note_article: 'note記事', script: '台本', video: '動画', report: 'レポート' };
export const EVENT_LABEL = { start: '開始', progress: '進行', finish: '完了', fail: '失敗', approval: '承認' };
