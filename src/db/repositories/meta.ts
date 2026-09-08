import { all, buildUpdate, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import { notFound } from '../../lib/errors.ts';
import type { Insight, MetaLevel, MetaObject, OptimizerAction } from '../../domain/types.ts';

export const metaAccounts = {
  create(input: { project_id: string; ad_account_id: string; page_id?: string; pixel_id?: string; instagram_id?: string; token_ref?: string }) {
    const id = newId('mac');
    run(
      `INSERT INTO meta_accounts (id, project_id, ad_account_id, page_id, pixel_id, instagram_id, token_ref, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, input.project_id, input.ad_account_id, input.page_id ?? null, input.pixel_id ?? null,
      input.instagram_id ?? null, input.token_ref ?? 'env:META_SYSTEM_USER_TOKEN', 'active', nowIso(),
    );
    return metaAccounts.byProject(input.project_id)!;
  },
  byProject: (projectId: string) =>
    get<{ id: string; project_id: string; ad_account_id: string; page_id: string | null; pixel_id: string | null; instagram_id: string | null; token_ref: string | null; status: string }>(
      "SELECT * FROM meta_accounts WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      projectId,
    ),
  requireByProject(projectId: string) {
    const row = metaAccounts.byProject(projectId);
    if (!row) throw notFound(`Meta広告アカウントが未接続です: ${projectId}`);
    return row;
  },
};

export const metaObjects = {
  create(input: Partial<MetaObject> & Pick<MetaObject, 'project_id' | 'level' | 'name'>): MetaObject {
    const id = input.id ?? newId('mob');
    const ts = nowIso();
    run(
      `INSERT INTO meta_objects
       (id, project_id, level, remote_id, parent_id, name, status, daily_budget, config, deliverable_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id, input.level, input.remote_id ?? null, input.parent_id ?? null,
      input.name, input.status ?? 'PAUSED', input.daily_budget ?? null,
      input.config ?? '{}', input.deliverable_id ?? null, ts, ts,
    );
    return metaObjects.require(id);
  },
  find: (id: string) => get<MetaObject>('SELECT * FROM meta_objects WHERE id = ?', id),
  require(id: string): MetaObject {
    const row = metaObjects.find(id);
    if (!row) throw notFound(`Meta広告オブジェクトが見つかりません: ${id}`);
    return row;
  },
  byRemote: (remoteId: string) => get<MetaObject>('SELECT * FROM meta_objects WHERE remote_id = ?', remoteId),
  list: (projectId: string, level?: MetaLevel) =>
    level
      ? all<MetaObject>('SELECT * FROM meta_objects WHERE project_id = ? AND level = ? ORDER BY created_at', projectId, level)
      : all<MetaObject>('SELECT * FROM meta_objects WHERE project_id = ? ORDER BY level, created_at', projectId),
  children: (parentId: string) =>
    all<MetaObject>('SELECT * FROM meta_objects WHERE parent_id = ? ORDER BY created_at', parentId),
  update(id: string, fields: Partial<MetaObject>) {
    buildUpdate('meta_objects', id, { ...fields, updated_at: nowIso() });
    return metaObjects.require(id);
  },
};

export const insights = {
  upsert(row: Omit<Insight, 'id' | 'synced_at'> & { id?: string }): void {
    run(
      `INSERT INTO meta_insights
       (id, project_id, date, level, object_id, remote_id, spend, impressions, clicks, reach, frequency,
        conversions, conversion_value, video_p25, video_p75, thruplays, raw, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date, level, object_id) DO UPDATE SET
         spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks,
         reach=excluded.reach, frequency=excluded.frequency, conversions=excluded.conversions,
         conversion_value=excluded.conversion_value, video_p25=excluded.video_p25,
         video_p75=excluded.video_p75, thruplays=excluded.thruplays, raw=excluded.raw,
         synced_at=excluded.synced_at`,
      row.id ?? newId('ins'), row.project_id, row.date, row.level, row.object_id, row.remote_id ?? null,
      row.spend, row.impressions, row.clicks, row.reach, row.frequency, row.conversions,
      row.conversion_value, row.video_p25, row.video_p75, row.thruplays, row.raw ?? null, nowIso(),
    );
  },
  byDate: (projectId: string, date: string, level?: string) =>
    level
      ? all<Insight>('SELECT * FROM meta_insights WHERE project_id = ? AND date = ? AND level = ?', projectId, date, level)
      : all<Insight>('SELECT * FROM meta_insights WHERE project_id = ? AND date = ?', projectId, date),
  range: (projectId: string, from: string, to: string, level?: string) =>
    level
      ? all<Insight>(
          'SELECT * FROM meta_insights WHERE project_id = ? AND date BETWEEN ? AND ? AND level = ? ORDER BY date',
          projectId, from, to, level,
        )
      : all<Insight>(
          'SELECT * FROM meta_insights WHERE project_id = ? AND date BETWEEN ? AND ? ORDER BY date',
          projectId, from, to,
        ),
  forObject: (objectId: string, from: string, to: string) =>
    all<Insight>('SELECT * FROM meta_insights WHERE object_id = ? AND date BETWEEN ? AND ? ORDER BY date', objectId, from, to),
};

export const optimizerActions = {
  create(input: Partial<OptimizerAction> & Pick<OptimizerAction, 'project_id' | 'date' | 'rule' | 'level' | 'action' | 'reason'>): OptimizerAction {
    const id = input.id ?? newId('opt');
    run(
      `INSERT INTO optimizer_actions
       (id, project_id, date, rule, level, object_id, object_name, action, reason, before, after, applied, applied_at, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id, input.date, input.rule, input.level, input.object_id ?? null,
      input.object_name ?? null, input.action, input.reason, input.before ?? null, input.after ?? null,
      input.applied ?? 0, input.applied_at ?? null, input.error ?? null, nowIso(),
    );
    return get<OptimizerAction>('SELECT * FROM optimizer_actions WHERE id = ?', id)!;
  },
  markApplied: (id: string, error?: string) =>
    run(
      'UPDATE optimizer_actions SET applied = ?, applied_at = ?, error = ? WHERE id = ?',
      error ? 0 : 1, nowIso(), error ?? null, id,
    ),
  byDate: (projectId: string, date: string) =>
    all<OptimizerAction>('SELECT * FROM optimizer_actions WHERE project_id = ? AND date = ? ORDER BY created_at', projectId, date),
  recent: (projectId: string, limit = 50) =>
    all<OptimizerAction>('SELECT * FROM optimizer_actions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', projectId, limit),
};
