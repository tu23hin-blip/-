// タイムゾーン付きの日付計算（依存ライブラリなし）。日付は 'YYYY-MM-DD'、時刻は 'HH:mm' の文字列で扱う。

function parts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

export function todayIn(tz, now = new Date()) {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}


export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDate, toDate) {
  return Math.round((new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000);
}

// 指定タイムゾーンのUTCオフセット（例: '+09:00'）
export function tzOffset(tz, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

export function toZonedIso(dateStr, timeStr, tz) {
  const offset = tzOffset(tz, new Date(`${dateStr}T${timeStr}:00Z`));
  return `${dateStr}T${timeStr}:00${offset}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// '9/26(土) 07:30'
export function labelJa(dateStr, timeStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})${timeStr ? ` ${timeStr}` : ''}`;
}

