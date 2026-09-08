import { all, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import type { Report } from '../../domain/types.ts';

export const events = {
  log(actor: string, action: string, subjectType?: string, subjectId?: string, payload?: unknown): void {
    run(
      'INSERT INTO events (id, actor, action, subject_type, subject_id, payload, created_at) VALUES (?,?,?,?,?,?,?)',
      newId('evt'), actor, action, subjectType ?? null, subjectId ?? null,
      payload === undefined ? null : JSON.stringify(payload), nowIso(),
    );
  },
  bySubject: (type: string, id: string, limit = 100) =>
    all('SELECT * FROM events WHERE subject_type = ? AND subject_id = ? ORDER BY created_at DESC LIMIT ?', type, id, limit),
  recent: (limit = 100) => all('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', limit),
};

export const notifications = {
  create(input: { project_id?: string | null; level?: 'info' | 'warn' | 'critical'; title: string; body?: string; channel?: string }) {
    const id = newId('ntf');
    run(
      'INSERT INTO notifications (id, project_id, level, title, body, channel, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, input.project_id ?? null, input.level ?? 'info', input.title, input.body ?? null,
      input.channel ?? 'inapp', 'pending', nowIso(),
    );
    return id;
  },
  pending: (limit = 100) =>
    all<{ id: string; project_id: string | null; level: string; title: string; body: string | null; channel: string }>(
      "SELECT * FROM notifications WHERE status = 'pending' ORDER BY created_at LIMIT ?", limit,
    ),
  markSent: (id: string, status = 'sent') =>
    run('UPDATE notifications SET status = ?, sent_at = ? WHERE id = ?', status, nowIso(), id),
  recent: (limit = 50) => all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?', limit),
};

export const reports = {
  save(input: {
    project_id?: string | null;
    scope?: string;
    type: 'daily' | 'weekly' | 'monthly';
    date: string;
    title: string;
    summary: unknown;
    markdown?: string;
    html?: string;
    storage_path?: string;
  }): Report {
    const existing = get<Report>(
      "SELECT * FROM reports WHERE scope = ? AND IFNULL(project_id,'') = ? AND type = ? AND date = ?",
      input.scope ?? 'project', input.project_id ?? '', input.type, input.date,
    );
    const id = existing?.id ?? newId('rpt');
    if (existing) {
      run(
        'UPDATE reports SET title = ?, summary = ?, markdown = ?, html = ?, storage_path = ? WHERE id = ?',
        input.title, JSON.stringify(input.summary), input.markdown ?? null, input.html ?? null,
        input.storage_path ?? null, id,
      );
    } else {
      run(
        `INSERT INTO reports (id, project_id, scope, type, date, title, summary, markdown, html, storage_path, delivery_status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, input.project_id ?? null, input.scope ?? 'project', input.type, input.date, input.title,
        JSON.stringify(input.summary), input.markdown ?? null, input.html ?? null,
        input.storage_path ?? null, 'pending', nowIso(),
      );
    }
    return reports.require(id);
  },
  find: (id: string) => get<Report>('SELECT * FROM reports WHERE id = ?', id),
  require(id: string): Report {
    const row = reports.find(id);
    if (!row) throw new Error(`レポートが見つかりません: ${id}`);
    return row;
  },
  list: (filter: { projectId?: string; type?: string; limit?: number } = {}) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter.type) { where.push('type = ?'); params.push(filter.type); }
    return all<Report>(
      `SELECT id, project_id, scope, type, date, title, summary, delivery_status, delivered_at, created_at
       FROM reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC LIMIT ?`,
      ...params, filter.limit ?? 100,
    );
  },
  markDelivered: (id: string, status: string) =>
    run('UPDATE reports SET delivery_status = ?, delivered_at = ? WHERE id = ?', status, nowIso(), id),
};

export const settings = {
  get: (key: string) => get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value,
  set: (key: string, value: string) =>
    run(
      'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key, value, nowIso(),
    ),
  all: () => all<{ key: string; value: string }>('SELECT key, value FROM settings'),
};
