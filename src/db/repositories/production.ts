import { all, buildUpdate, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import { notFound } from '../../lib/errors.ts';
import type { Asset, Deliverable, PipelineRun, PipelineStepRecord } from '../../domain/types.ts';

export const assets = {
  create(input: Partial<Asset> & Pick<Asset, 'source' | 'kind' | 'storage_path'>): Asset {
    const id = input.id ?? newId('ast');
    run(
      `INSERT INTO assets
       (id, project_id, order_id, source, kind, provider, model, prompt, storage_path, mime, bytes,
        width, height, duration_sec, checksum, license_note, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id ?? null, input.order_id ?? null, input.source, input.kind,
      input.provider ?? null, input.model ?? null, input.prompt ?? null, input.storage_path,
      input.mime ?? null, input.bytes ?? 0, input.width ?? null, input.height ?? null,
      input.duration_sec ?? null, input.checksum ?? null, input.license_note ?? null,
      input.meta ?? null, nowIso(),
    );
    return assets.require(id);
  },
  find: (id: string) => get<Asset>('SELECT * FROM assets WHERE id = ?', id),
  require(id: string): Asset {
    const row = assets.find(id);
    if (!row) throw notFound(`素材が見つかりません: ${id}`);
    return row;
  },
  byOrder: (orderId: string) => all<Asset>('SELECT * FROM assets WHERE order_id = ? ORDER BY created_at', orderId),
  byProject: (projectId: string) =>
    all<Asset>('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC', projectId),
  byIds(ids: string[]): Asset[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return all<Asset>(`SELECT * FROM assets WHERE id IN (${placeholders})`, ...ids);
  },
};

export const deliverables = {
  create(input: Partial<Deliverable> & Pick<Deliverable, 'order_id' | 'project_id' | 'kind' | 'title'>): Deliverable {
    const id = input.id ?? newId('dlv');
    const ts = nowIso();
    const version = input.version
      ?? (get<{ v: number }>('SELECT IFNULL(MAX(version),0)+1 AS v FROM deliverables WHERE order_id = ?', input.order_id)?.v ?? 1);
    run(
      `INSERT INTO deliverables
       (id, order_id, project_id, kind, version, title, status, storage_path, preview_path, content,
        spec, qc, legal_status, approved_at, delivered_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.order_id, input.project_id, input.kind, version, input.title,
      input.status ?? 'draft', input.storage_path ?? null, input.preview_path ?? null,
      input.content ?? null, input.spec ?? null, input.qc ?? null, input.legal_status ?? 'pending',
      input.approved_at ?? null, input.delivered_at ?? null, ts, ts,
    );
    return deliverables.require(id);
  },
  find: (id: string) => get<Deliverable>('SELECT * FROM deliverables WHERE id = ?', id),
  require(id: string): Deliverable {
    const row = deliverables.find(id);
    if (!row) throw notFound(`納品物が見つかりません: ${id}`);
    return row;
  },
  byOrder: (orderId: string) =>
    all<Deliverable>('SELECT * FROM deliverables WHERE order_id = ? ORDER BY version DESC', orderId),
  byProject: (projectId: string) =>
    all<Deliverable>('SELECT * FROM deliverables WHERE project_id = ? ORDER BY created_at DESC', projectId),
  approved: (projectId: string) =>
    all<Deliverable>(
      "SELECT * FROM deliverables WHERE project_id = ? AND status IN ('approved','delivered') ORDER BY created_at DESC",
      projectId,
    ),
  update(id: string, fields: Partial<Deliverable>) {
    buildUpdate('deliverables', id, { ...fields, updated_at: nowIso() });
    return deliverables.require(id);
  },
};

export const pipelineRuns = {
  start(orderId: string, pipeline: string, steps: PipelineStepRecord[], context: unknown): PipelineRun {
    const id = newId('run');
    run(
      `INSERT INTO pipeline_runs (id, order_id, pipeline, status, current_step, steps, context, started_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, orderId, pipeline, 'running', steps[0]?.name ?? null,
      JSON.stringify(steps), JSON.stringify(context ?? {}), nowIso(),
    );
    return pipelineRuns.require(id);
  },
  find: (id: string) => get<PipelineRun>('SELECT * FROM pipeline_runs WHERE id = ?', id),
  require(id: string): PipelineRun {
    const row = pipelineRuns.find(id);
    if (!row) throw notFound(`パイプライン実行が見つかりません: ${id}`);
    return row;
  },
  byOrder: (orderId: string) =>
    all<PipelineRun>('SELECT * FROM pipeline_runs WHERE order_id = ? ORDER BY started_at DESC', orderId),
  latest: (orderId: string) =>
    get<PipelineRun>('SELECT * FROM pipeline_runs WHERE order_id = ? ORDER BY started_at DESC LIMIT 1', orderId),
  saveSteps(id: string, steps: PipelineStepRecord[], currentStep: string | null, context: unknown): void {
    run(
      'UPDATE pipeline_runs SET steps = ?, current_step = ?, context = ? WHERE id = ?',
      JSON.stringify(steps), currentStep, JSON.stringify(context ?? {}), id,
    );
  },
  finish(id: string, status: 'succeeded' | 'failed' | 'cancelled', error?: string): void {
    run(
      'UPDATE pipeline_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?',
      status, nowIso(), error ?? null, id,
    );
  },
};
