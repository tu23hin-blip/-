// 画面(web)とレポートで使う読み取り用クエリ。
// 方針: 数字がない日は 0 ではなく null を返す。
import fs from 'node:fs';
import path from 'node:path';
import { config, localDate, addDays, mondayOf } from '../config.js';

const parseJSON = (s, fallback = null) => { if (!s) return fallback; try { return JSON.parse(s); } catch { return fallback; } };
const toLocalDate = (iso) => (iso ? localDate(new Date(iso)) : null);

export const METRIC_LABELS = {
  revenue_jpy: '売上', impressions: 'インプレッション', clicks: 'クリック', followers: 'フォロワー',
  posts: '投稿数', work_minutes: '作業時間（分）', api_cost_jpy: 'APIコスト',
};
// 合計ではなく最新値で見る指標
const SNAPSHOT_METRICS = new Set(['followers']);

function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 期間内の指標合計（division-level のみ）。値が1つもなければ null */
function sumMetric(db, name, from, to, divisionId = null) {
  if (SNAPSHOT_METRICS.has(name)) {
    const r = db.prepare(`SELECT value FROM metrics WHERE name = ? AND output_id IS NULL AND date BETWEEN ? AND ?
      AND value IS NOT NULL ${divisionId ? 'AND division_id = ?' : ''} ORDER BY date DESC LIMIT 1`)
      .get(...[name, from, to, ...(divisionId ? [divisionId] : [])]);
    return r ? r.value : null;
  }
  const r = db.prepare(`SELECT SUM(value) s, COUNT(value) c FROM metrics WHERE name = ? AND output_id IS NULL
    AND date BETWEEN ? AND ? ${divisionId ? 'AND division_id = ?' : ''}`)
    .get(...[name, from, to, ...(divisionId ? [divisionId] : [])]);
  return r.c > 0 ? r.s : null;
}

const minus = (a, b) => (a == null || b == null ? null : a - b);

export function parseGoal(goalText) {
  const g = parseJSON(goalText);
  if (!g || !g.metric || g.target == null) return null;
  return g;
}

export function goalLabel(goal) {
  if (!goal) return null;
  const unit = goal.metric === 'revenue_jpy' || goal.metric === 'api_cost_jpy' ? '円' : goal.metric === 'work_minutes' ? '分' : '';
  return `${METRIC_LABELS[goal.metric] || goal.metric} ${Number(goal.target).toLocaleString('ja-JP')}${unit}`;
}

/** 経営ダッシュボード用 */
export function dashboard(db, { days = 30, today = localDate() } = {}) {
  const from = addDays(today, -(days - 1));
  const dates = dateRange(from, today);

  // 日別（全事業部合計）
  const rows = db.prepare(`SELECT date, name, SUM(value) s, COUNT(value) c FROM metrics
    WHERE output_id IS NULL AND date BETWEEN ? AND ? AND name IN ('revenue_jpy','api_cost_jpy')
    GROUP BY date, name`).all(from, today);
  const byDate = {};
  for (const r of rows) (byDate[r.date] ||= {})[r.name] = r.c > 0 ? r.s : null;
  const daily = dates.map((d) => {
    const revenue = byDate[d]?.revenue_jpy ?? null;
    const cost = byDate[d]?.api_cost_jpy ?? null;
    return { date: d, revenue, cost, profit: minus(revenue, cost) };
  });

  // 今月と前月（同じ日数）
  const [y, m, dd] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const prevMonthStartDate = new Date(y, m - 2, 1);
  const prevMonthStart = localDate(prevMonthStartDate);
  const prevMonthLastDay = new Date(y, m - 1, 0).getDate();
  const prevSameDay = localDate(new Date(prevMonthStartDate.getFullYear(), prevMonthStartDate.getMonth(), Math.min(dd, prevMonthLastDay)));
  const revenueThisMonth = sumMetric(db, 'revenue_jpy', monthStart, today);
  const revenuePrevMonth = sumMetric(db, 'revenue_jpy', prevMonthStart, prevSameDay);
  const mom = revenueThisMonth != null && revenuePrevMonth ? (revenueThisMonth - revenuePrevMonth) / revenuePrevMonth : null;

  const period = {};
  for (const n of ['revenue_jpy', 'impressions', 'clicks', 'posts', 'work_minutes', 'api_cost_jpy']) period[n] = sumMetric(db, n, from, today);
  period.profit = minus(period.revenue_jpy, period.api_cost_jpy);

  const divisions = db.prepare('SELECT * FROM divisions ORDER BY id').all();
  const weekStart = mondayOf(today);
  const byDivision = divisions.map((d) => ({
    slug: d.slug, name: d.name,
    revenue: sumMetric(db, 'revenue_jpy', from, today, d.id),
    impressions: sumMetric(db, 'impressions', from, today, d.id),
  }));
  const goals = divisions.map((d) => {
    const goal = parseGoal(d.weekly_goal);
    const actual = goal ? sumMetric(db, goal.metric, weekStart, today, d.id) : null;
    return {
      slug: d.slug, name: d.name, status: d.status,
      goal, goal_label: goalLabel(goal) ?? (d.weekly_goal || null),
      actual, rate: goal && actual != null && goal.target ? actual / goal.target : null,
    };
  });

  return {
    today, from, days, week_start: weekStart,
    month: { start: monthStart, revenue: revenueThisMonth, prev_revenue: revenuePrevMonth, prev_range: [prevMonthStart, prevSameDay], mom },
    period, daily, by_division: byDivision, goals,
    latest_report: latestReport(db),
    seeded: db.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get()?.value === '1',
  };
}

export function latestReport(db) {
  const r = db.prepare(`SELECT o.id, o.title, o.file_path, o.created_at FROM outputs o
    WHERE o.kind = 'report' AND json_extract(o.meta, '$.type') = 'weekly_report'
    ORDER BY o.created_at DESC, o.id DESC LIMIT 1`).get();
  return r || null;
}

function lampOf({ running, pending, lastTask }) {
  if (running.length > 0) return 'running';
  if (lastTask && lastTask.status === 'failed') return 'failed';
  if (pending > 0) return 'awaiting';
  return 'idle';
}

/** 事業部ビューのカード一覧 */
export function divisionsOverview(db, { today = localDate() } = {}) {
  const divisions = db.prepare('SELECT * FROM divisions ORDER BY id').all();
  return divisions.map((d) => {
    const running = db.prepare("SELECT id, title, started_at FROM tasks WHERE division_id = ? AND status = 'running' ORDER BY started_at").all(d.id);
    const pending = db.prepare("SELECT COUNT(*) c FROM outputs WHERE division_id = ? AND approval = 'pending'").get(d.id).c;
    const queued = db.prepare("SELECT COUNT(*) c FROM tasks WHERE division_id = ? AND status = 'queued'").get(d.id).c;
    const recent = db.prepare(`SELECT status, finished_at FROM tasks WHERE division_id = ? AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 200`).all(d.id);
    const doneToday = recent.filter((t) => t.status !== 'failed' && toLocalDate(t.finished_at) === today).length;
    const lastTask = db.prepare(`SELECT id, title, status, error, finished_at FROM tasks WHERE division_id = ? AND status != 'queued'
      ORDER BY COALESCE(finished_at, started_at) DESC, id DESC LIMIT 1`).get(d.id);
    const lastEvent = db.prepare('SELECT type, message, created_at FROM events WHERE division_id = ? ORDER BY id DESC LIMIT 1').get(d.id);
    return {
      id: d.id, slug: d.slug, name: d.name, status: d.status, skill_name: d.skill_name,
      goal_label: goalLabel(parseGoal(d.weekly_goal)),
      lamp: lampOf({ running, pending, lastTask }),
      running, pending, queued, done_today: doneToday, last_task: lastTask || null, last_event: lastEvent || null,
    };
  });
}

/** 事業部の詳細 */
export function divisionDetail(db, slug) {
  const d = db.prepare('SELECT * FROM divisions WHERE slug = ?').get(slug);
  if (!d) return null;
  const overview = divisionsOverview(db).find((x) => x.slug === slug);
  const tasks = db.prepare(`SELECT * FROM tasks WHERE division_id = ? ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 200`).all(d.id);
  const grouped = { running: [], queued: [], awaiting_approval: [], failed: [], done: [] };
  for (const t of tasks) grouped[t.status]?.push(t);
  const events = db.prepare('SELECT * FROM events WHERE division_id = ? ORDER BY created_at DESC, id DESC LIMIT 150').all(d.id);
  const outputs = db.prepare('SELECT * FROM outputs WHERE division_id = ? ORDER BY created_at DESC, id DESC LIMIT 40').all(d.id)
    .map((o) => ({ ...o, meta: parseJSON(o.meta, {}) }));
  return { division: { ...d, goal: parseGoal(d.weekly_goal), goal_label: goalLabel(parseGoal(d.weekly_goal)) }, overview, tasks: grouped, events, outputs };
}

/** 承認待ちの受け箱 */
export function inbox(db) {
  const q = (where, order, limit) => db.prepare(`SELECT o.*, d.name division_name, d.slug division_slug FROM outputs o
    JOIN divisions d ON d.id = o.division_id WHERE ${where} ORDER BY ${order} LIMIT ${limit}`).all()
    .map((o) => ({ ...o, meta: parseJSON(o.meta, {}), content: readOutputFile(o.file_path) }));
  return {
    pending: q("o.approval = 'pending'", 'o.created_at DESC, o.id DESC', 200),
    approved: q("o.approval = 'approved' AND o.kind != 'report'", 'o.created_at DESC, o.id DESC', 50),
  };
}

/** 成果物ファイルを読む（outputs/ と knowledge/ の中だけ） */
export function readOutputFile(filePath) {
  if (!filePath) return null;
  const abs = path.resolve(config.root, filePath);
  const allowed = [config.outputsDir, config.knowledgeDir].some((dir) => abs.startsWith(dir + path.sep));
  if (!allowed || !fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

export function outputDetail(db, id) {
  const o = db.prepare('SELECT o.*, d.name division_name, d.slug division_slug FROM outputs o JOIN divisions d ON d.id = o.division_id WHERE o.id = ?').get(id);
  if (!o) return null;
  return { ...o, meta: parseJSON(o.meta, {}), content: readOutputFile(o.file_path) };
}

/** 今日のAPIコスト合計（全事業部）。記録がなければ 0（上限判定用） */
export function todayApiCost(db, today = localDate()) {
  return db.prepare("SELECT COALESCE(SUM(value),0) s FROM metrics WHERE name = 'api_cost_jpy' AND date = ?").get(today).s;
}
