// 5項目の cron 式（分 時 日 月 曜日）の判定。* / 数字 / a-b / a,b / */n / a-b/n に対応。
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]; // 曜日の 7 は日曜(0)

function parseField(field, [min, max]) {
  const set = new Set();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo, hi;
    if (rangePart === '*') { lo = min; hi = max; }
    else if (rangePart.includes('-')) [lo, hi] = rangePart.split('-').map(Number);
    else { lo = Number(rangePart); hi = stepPart ? max : lo; }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron の値が不正: ${field}`);
    for (let v = lo; v <= hi; v += step) set.add(max === 7 && v === 7 ? 0 : v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron は5項目で書いてください: "${expr}"`);
  const sets = parts.map((p, i) => parseField(p, RANGES[i]));
  return { expr, sets, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

export function cronMatches(cron, date) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const [mi, h, dom, mon, dow] = c.sets;
  if (!mi.has(date.getMinutes()) || !h.has(date.getHours()) || !mon.has(date.getMonth() + 1)) return false;
  const domOk = dom.has(date.getDate()), dowOk = dow.has(date.getDay());
  // 標準 cron: 日と曜日が両方指定されていればどちらか一致で実行
  if (!c.domStar && !c.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** 次に実行される時刻（表示用） */
export function nextRun(cron, from = new Date()) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i++) { if (cronMatches(c, d)) return d; d.setMinutes(d.getMinutes() + 1); }
  return null;
}
