/** すべての業務日付は JST 基準。DB には ISO8601(UTC) を保存し、境界だけ JST で切る。 */
const JST_OFFSET_MIN = 9 * 60;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toJst(date: Date): Date {
  return new Date(date.getTime() + JST_OFFSET_MIN * 60_000);
}

/** YYYY-MM-DD（JST） */
export function jstDateString(date: Date = new Date()): string {
  return toJst(date).toISOString().slice(0, 10);
}

export function jstHour(date: Date = new Date()): number {
  return toJst(date).getUTCHours();
}

/** JST の 00:00:00 / 23:59:59.999 を UTC ISO で返す */
export function jstDayRange(dateStr: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateStr}T00:00:00.000+09:00`);
  const end = new Date(`${dateStr}T23:59:59.999+09:00`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return jstDateString(d);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00+09:00`).getTime();
  const b = new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 月末日（YYYY-MM-DD, JST） */
export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 0));
  return d.toISOString().slice(0, 10);
}

export function formatJp(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}
