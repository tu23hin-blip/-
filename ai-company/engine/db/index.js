// DB接続と、事業部のコードから使う記録用ライブラリ。
//   start_task / log_event / save_output / finish_task / fail_task / record_metric
// 画面(web)からの承認操作もここを通す（outputs と events を必ず一緒に更新するため）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config, localDate } from '../config.js';
import { pendingMigrations } from './migrate.js';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export const METRIC_NAMES = ['revenue_jpy', 'sales_count', 'impressions', 'clicks', 'followers', 'posts', 'work_minutes', 'api_cost_jpy'];
// 投稿ごとに入力できる指標
export const POST_METRIC_NAMES = ['impressions', 'clicks'];
export const OUTPUT_KINDS = ['x_post', 'note_article', 'script', 'video', 'report'];

export function openDb(dbPath = config.dbPath, { skipMigrationCheck = false } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 10000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (!skipMigrationCheck) {
    const todo = pendingMigrations(db);
    if (todo.length) {
      db.close();
      throw new Error(`DBの形式が古いです（${todo.join(' / ')}）。npm run db:migrate を実行してください（データは保持されます）`);
    }
  }
  return db;
}

let shared = null;
export function getDb() {
  if (!shared) shared = openDb();
  return shared;
}

const now = () => new Date().toISOString();

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function parseMeta(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * 記録用ライブラリを作る。db を差し替えればテストでも使える。
 */
export function createRecorder(db) {
  function resolveDivision(division) {
    if (division == null) return null;
    const row = typeof division === 'number'
      ? db.prepare('SELECT * FROM divisions WHERE id = ?').get(division)
      : db.prepare('SELECT * FROM divisions WHERE slug = ? OR name = ?').get(division, division);
    if (!row) throw new Error(`事業部が見つかりません: ${division}`);
    return row;
  }

  function getTask(taskId) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!t) throw new Error(`タスクが見つかりません: ${taskId}`);
    return t;
  }

  function log_event({ division = null, task_id = null, type = 'progress', message }) {
    let divisionId = division == null ? null : resolveDivision(division).id;
    if (divisionId == null && task_id != null) divisionId = getTask(task_id).division_id;
    const r = db.prepare('INSERT INTO events (division_id, task_id, type, message, created_at) VALUES (?,?,?,?,?)')
      .run(divisionId, task_id, type, String(message), now());
    return Number(r.lastInsertRowid);
  }

  function ensure_division({ slug, name, skill_name = null, weekly_goal = null, status }) {
    const existing = db.prepare('SELECT * FROM divisions WHERE slug = ?').get(slug);
    const goal = weekly_goal == null ? null : (typeof weekly_goal === 'string' ? weekly_goal : JSON.stringify(weekly_goal));
    if (existing) {
      db.prepare('UPDATE divisions SET name = ?, skill_name = COALESCE(?, skill_name), weekly_goal = COALESCE(weekly_goal, ?) WHERE id = ?')
        .run(name, skill_name, goal, existing.id);
      return existing.id;
    }
    const r = db.prepare('INSERT INTO divisions (slug, name, status, skill_name, weekly_goal, created_at) VALUES (?,?,?,?,?,?)')
      .run(slug, name, status || 'active', skill_name, goal, now());
    return Number(r.lastInsertRowid);
  }

  /** タスク開始。task_id を渡すと queued のタスクを running にする */
  function start_task({ division, title, detail = null, task_id = null }) {
    return tx(db, () => {
      let id = task_id;
      if (id != null) {
        const t = getTask(id);
        db.prepare("UPDATE tasks SET status = 'running', started_at = ?, error = NULL WHERE id = ?").run(now(), id);
        title = title || t.title;
        division = t.division_id;
      } else {
        const div = resolveDivision(division);
        const r = db.prepare("INSERT INTO tasks (division_id, title, detail, status, started_at, created_at) VALUES (?,?,?, 'running', ?, ?)")
          .run(div.id, title, detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)), now(), now());
        id = Number(r.lastInsertRowid);
      }
      log_event({ task_id: id, type: 'start', message: `開始: ${title}` });
      return id;
    });
  }

  /** キューにタスクを積む（修正依頼など） */
  function queue_task({ division, title, detail = null }) {
    const div = resolveDivision(division);
    const r = db.prepare("INSERT INTO tasks (division_id, title, detail, status, created_at) VALUES (?,?,?, 'queued', ?)")
      .run(div.id, title, detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)), now());
    return Number(r.lastInsertRowid);
  }

  /** 成果物を保存。既定は approval=pending（公開はしない） */
  function save_output({ task_id, kind, file_path = null, preview_text = null, title = null, meta = null, approval = 'pending', division = null }) {
    if (!OUTPUT_KINDS.includes(kind)) throw new Error(`不明な成果物の種類: ${kind}`);
    const divisionId = division != null ? resolveDivision(division).id : getTask(task_id).division_id;
    const rel = file_path && path.isAbsolute(file_path) ? path.relative(config.root, file_path) : file_path;
    const r = db.prepare(`INSERT INTO outputs (task_id, division_id, kind, file_path, preview_text, approval, title, meta, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(task_id ?? null, divisionId, kind, rel, preview_text, approval,
      title, meta ? JSON.stringify(meta) : null, now());
    const id = Number(r.lastInsertRowid);
    log_event({ division: divisionId, task_id: task_id ?? null, type: 'progress',
      message: `成果物を保存（${kind}${approval === 'pending' ? '・承認待ち' : ''}）: ${title || rel || id}` });
    return id;
  }

  /** 正常終了。承認待ちの成果物があれば awaiting_approval、なければ done */
  function finish_task(task_id, { message } = {}) {
    return tx(db, () => {
      const pending = db.prepare("SELECT COUNT(*) c FROM outputs WHERE task_id = ? AND approval = 'pending'").get(task_id).c;
      const status = pending > 0 ? 'awaiting_approval' : 'done';
      db.prepare('UPDATE tasks SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), task_id);
      log_event({ task_id, type: 'finish',
        message: message || (pending > 0 ? `完了（承認待ち ${pending} 件）` : '完了') });
      return status;
    });
  }

  function fail_task(task_id, error) {
    const msg = error instanceof Error ? error.message : String(error);
    return tx(db, () => {
      db.prepare("UPDATE tasks SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(now(), msg, task_id);
      log_event({ task_id, type: 'fail', message: `失敗: ${msg}` });
    });
  }

  /** 数字を記録（同じ日・事業部・名前・投稿なら上書き）。value=null は「不明」 */
  function record_metric({ date = localDate(), division, name, value, output_id = null }) {
    if (!METRIC_NAMES.includes(name)) throw new Error(`不明な指標: ${name}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日付の形式が不正: ${date}`);
    const v = value === null || value === undefined || value === '' ? null : Number(value);
    if (v !== null && !Number.isFinite(v)) throw new Error(`数値ではありません: ${value}`);
    const div = resolveDivision(division);
    const existing = db.prepare('SELECT id FROM metrics WHERE date = ? AND division_id = ? AND name = ? AND IFNULL(output_id,0) = IFNULL(?,0)')
      .get(date, div.id, name, output_id);
    if (existing) db.prepare('UPDATE metrics SET value = ? WHERE id = ?').run(v, existing.id);
    else db.prepare('INSERT INTO metrics (date, division_id, name, value, output_id) VALUES (?,?,?,?,?)').run(date, div.id, name, v, output_id);
  }

  /** 既存の値に加算（APIコスト・投稿数など） */
  function add_metric({ date = localDate(), division, name, value, output_id = null }) {
    const div = resolveDivision(division);
    const cur = db.prepare('SELECT value FROM metrics WHERE date = ? AND division_id = ? AND name = ? AND IFNULL(output_id,0) = IFNULL(?,0)')
      .get(date, div.id, name, output_id);
    record_metric({ date, division: div.id, name, value: (cur?.value ?? 0) + Number(value), output_id });
  }

  function parseInput(v, label, { integer = false } = {}) {
    if (v === null || v === undefined || String(v).trim() === '') return undefined; // 空欄 = 変更しない
    const n = Number(String(v).replace(/[,，¥円件\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}は0以上の数値で入力してください`);
    if (integer && !Number.isInteger(n)) throw new Error(`${label}は整数で入力してください`);
    return n;
  }

  function checkInputDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日付は YYYY-MM-DD で入力してください');
    if (date > localDate()) throw new Error('未来の日付には入力できません');
  }

  /** 投稿ごとの数字（入力日時点の累計）を記録。空欄の項目は変更しない */
  function record_output_metrics(output_id, { impressions, clicks, date = localDate() } = {}) {
    checkInputDate(date);
    const values = { impressions: parseInput(impressions, 'インプレッション', { integer: true }), clicks: parseInput(clicks, 'クリック', { integer: true }) };
    const given = Object.entries(values).filter(([, v]) => v !== undefined);
    if (given.length === 0) throw new Error('インプレッションかクリックのどちらかを入力してください');
    return tx(db, () => {
      const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(output_id);
      if (!o) throw new Error(`成果物が見つかりません: ${output_id}`);
      if (o.approval !== 'approved') throw new Error('承認済みの成果物だけ数字を入力できます');
      for (const [name, value] of given) record_metric({ date, division: o.division_id, name, value, output_id });
      log_event({ division: o.division_id, task_id: o.task_id, type: 'progress',
        message: `投稿の数字を入力（${date}時点）: ${o.title || o.kind} — ${given.map(([n, v]) => `${n === 'impressions' ? 'インプ' : 'クリック'} ${v.toLocaleString('ja-JP')}`).join(' / ')}` });
      return Object.fromEntries(given);
    });
  }

  /** 売上・販売件数（事業部全体・日別）を記録。空欄の項目は変更しない */
  function record_sales({ division, date, revenue_jpy, sales_count }) {
    checkInputDate(date);
    const div = resolveDivision(division);
    const values = { revenue_jpy: parseInput(revenue_jpy, '売上'), sales_count: parseInput(sales_count, '販売件数', { integer: true }) };
    const given = Object.entries(values).filter(([, v]) => v !== undefined);
    if (given.length === 0) throw new Error('売上か販売件数のどちらかを入力してください');
    return tx(db, () => {
      for (const [name, value] of given) record_metric({ date, division: div.id, name, value });
      log_event({ division: div.id, type: 'progress',
        message: `売上を入力（${date}）: ${given.map(([n, v]) => (n === 'revenue_jpy' ? `¥${v.toLocaleString('ja-JP')}` : `${v}件`)).join(' / ')}` });
      return get_sales({ division: div.id, date });
    });
  }

  function get_sales({ division, date }) {
    const div = resolveDivision(division);
    const rows = db.prepare(`SELECT name, value FROM metrics WHERE division_id = ? AND date = ? AND output_id IS NULL
      AND name IN ('revenue_jpy','sales_count')`).all(div.id, date);
    const by = Object.fromEntries(rows.map((r) => [r.name, r.value]));
    return { division: div.slug, date, revenue_jpy: by.revenue_jpy ?? null, sales_count: by.sales_count ?? null };
  }

  function refreshTaskStatus(taskId) {
    if (taskId == null) return;
    const t = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
    if (!t || t.status !== 'awaiting_approval') return;
    const pending = db.prepare("SELECT COUNT(*) c FROM outputs WHERE task_id = ? AND approval = 'pending'").get(taskId).c;
    if (pending === 0) db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(taskId);
  }

  /** 人間の承認／却下。goal_update 提案の承認時だけ weekly_goal を書き換える */
  function set_approval(output_id, approval, { comment = null } = {}) {
    if (!['approved', 'rejected'].includes(approval)) throw new Error(`不正な承認状態: ${approval}`);
    return tx(db, () => {
      const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(output_id);
      if (!o) throw new Error(`成果物が見つかりません: ${output_id}`);
      const meta = parseMeta(o.meta);
      if (comment) (meta.comments ||= []).push({ at: now(), text: comment, action: approval });
      db.prepare('UPDATE outputs SET approval = ?, meta = ? WHERE id = ?').run(approval, JSON.stringify(meta), output_id);
      const label = approval === 'approved' ? '承認' : '却下';
      log_event({ division: o.division_id, task_id: o.task_id, type: 'approval',
        message: `${label}: ${o.title || o.kind}${comment ? `（コメント: ${comment}）` : ''}` });
      if (approval === 'approved' && meta.type === 'goal_update' && meta.division_slug && meta.new_goal) {
        const target = resolveDivision(meta.division_slug);
        db.prepare('UPDATE divisions SET weekly_goal = ? WHERE id = ?').run(JSON.stringify(meta.new_goal), target.id);
        log_event({ division: target.id, type: 'approval', message: `今週の目標を更新: ${JSON.stringify(meta.new_goal)}` });
      }
      refreshTaskStatus(o.task_id);
    });
  }

  /** 修正コメント: 元の成果物は却下にして、修正タスクをキューに積む */
  function request_revision(output_id, comment) {
    if (!comment || !comment.trim()) throw new Error('修正コメントを入力してください');
    return tx(db, () => {
      const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(output_id);
      if (!o) throw new Error(`成果物が見つかりません: ${output_id}`);
      const meta = parseMeta(o.meta);
      (meta.comments ||= []).push({ at: now(), text: comment, action: 'revision' });
      meta.revision_requested = true;
      db.prepare("UPDATE outputs SET approval = 'rejected', meta = ? WHERE id = ?").run(JSON.stringify(meta), output_id);
      const taskId = queue_task({ division: o.division_id, title: `修正: ${o.title || o.kind}`,
        detail: { revise_output_id: o.id, comment } });
      log_event({ division: o.division_id, task_id: o.task_id, type: 'approval',
        message: `修正依頼: ${o.title || o.kind}（${comment}）→ 修正タスク #${taskId} を待機中に追加` });
      refreshTaskStatus(o.task_id);
      return taskId;
    });
  }

  /** 人間が手動投稿した後に URL を登録。投稿数を1増やす */
  function set_published(output_id, url) {
    return tx(db, () => {
      const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(output_id);
      if (!o) throw new Error(`成果物が見つかりません: ${output_id}`);
      if (o.approval !== 'approved') throw new Error('承認済みの成果物だけ投稿済みにできます');
      const first = !o.published_url;
      db.prepare('UPDATE outputs SET published_url = ? WHERE id = ?').run(url, output_id);
      if (first) add_metric({ division: o.division_id, name: 'posts', value: 1 });
      log_event({ division: o.division_id, task_id: o.task_id, type: 'approval', message: `手動投稿済み: ${url}` });
    });
  }

  function set_division_status(division, status, reason = null) {
    if (!['active', 'paused'].includes(status)) throw new Error(`不正な状態: ${status}`);
    const div = resolveDivision(division);
    db.prepare('UPDATE divisions SET status = ? WHERE id = ?').run(status, div.id);
    log_event({ division: div.id, type: 'progress',
      message: `${status === 'paused' ? '一時停止' : '再開'}${reason ? `: ${reason}` : ''}` });
  }

  function set_meta(key, value) {
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value == null ? null : String(value));
  }
  function get_meta(key) {
    return db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value ?? null;
  }

  return {
    db, resolveDivision, ensure_division,
    start_task, queue_task, log_event, save_output, finish_task, fail_task,
    record_metric, add_metric, record_output_metrics, record_sales, get_sales, set_approval, request_revision, set_published, set_division_status,
    set_meta, get_meta,
  };
}

let sharedRecorder = null;
function rec() {
  if (!sharedRecorder) sharedRecorder = createRecorder(getDb());
  return sharedRecorder;
}

// 共有DBに対するショートカット（事業部のコードからはこれを使う）
export const start_task = (...a) => rec().start_task(...a);
export const log_event = (...a) => rec().log_event(...a);
export const save_output = (...a) => rec().save_output(...a);
export const finish_task = (...a) => rec().finish_task(...a);
export const fail_task = (...a) => rec().fail_task(...a);
export const record_metric = (...a) => rec().record_metric(...a);
export const recorder = () => rec();
