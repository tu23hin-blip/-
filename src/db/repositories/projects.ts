import { all, buildUpdate, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import { notFound } from '../../lib/errors.ts';
import type { Order, OrderStatus, Project } from '../../domain/types.ts';

export const projects = {
  create(input: Partial<Project> & Pick<Project, 'advertiser_id' | 'client_org_id' | 'agency_org_id' | 'media_org_id' | 'name'>): Project {
    const id = input.id ?? newId('prj');
    const ts = nowIso();
    run(
      `INSERT INTO projects
       (id, advertiser_id, client_org_id, agency_org_id, media_org_id, name, status, objective,
        monthly_budget, daily_budget, target_cpa, target_roas, revenue_model, client_unit_price,
        media_unit_price, agency_margin_rate, start_date, end_date, autopilot, autopilot_level, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.advertiser_id, input.client_org_id, input.agency_org_id, input.media_org_id,
      input.name, input.status ?? 'active', input.objective ?? 'conversions',
      input.monthly_budget ?? 0, input.daily_budget ?? 0, input.target_cpa ?? 0, input.target_roas ?? 0,
      input.revenue_model ?? 'fixed', input.client_unit_price ?? 0, input.media_unit_price ?? 0,
      input.agency_margin_rate ?? 0.2, input.start_date ?? null, input.end_date ?? null,
      input.autopilot ?? 1, input.autopilot_level ?? 'suggest', ts, ts,
    );
    return projects.require(id);
  },
  find: (id: string) => get<Project>('SELECT * FROM projects WHERE id = ?', id),
  require(id: string): Project {
    const row = projects.find(id);
    if (!row) throw notFound(`案件が見つかりません: ${id}`);
    return row;
  },
  list: (status?: string) =>
    status
      ? all<Project>('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC', status)
      : all<Project>('SELECT * FROM projects ORDER BY created_at DESC'),
  active: () => all<Project>("SELECT * FROM projects WHERE status = 'active' ORDER BY created_at"),
  update(id: string, fields: Partial<Project>) {
    buildUpdate('projects', id, { ...fields, updated_at: nowIso() });
    return projects.require(id);
  },
};

export const orders = {
  create(input: Partial<Order> & Pick<Order, 'project_id' | 'type' | 'title' | 'brief'>): Order {
    const id = input.id ?? newId('ord');
    const ts = nowIso();
    run(
      `INSERT INTO orders
       (id, project_id, type, title, brief, quantity, status, priority, due_date,
        client_amount, media_amount, requested_by, auto_generated, source_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id, input.type, input.title, input.brief, input.quantity ?? 1,
      input.status ?? 'requested', input.priority ?? 5, input.due_date ?? null,
      input.client_amount ?? 0, input.media_amount ?? 0, input.requested_by ?? null,
      input.auto_generated ?? 0, input.source_ref ?? null, ts, ts,
    );
    return orders.require(id);
  },
  find: (id: string) => get<Order>('SELECT * FROM orders WHERE id = ?', id),
  require(id: string): Order {
    const row = orders.find(id);
    if (!row) throw notFound(`発注が見つかりません: ${id}`);
    return row;
  },
  list(filter: { projectId?: string; status?: OrderStatus; type?: string; limit?: number } = {}): Order[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter.status) { where.push('status = ?'); params.push(filter.status); }
    if (filter.type) { where.push('type = ?'); params.push(filter.type); }
    const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY priority ASC, created_at DESC LIMIT ?`;
    return all<Order>(sql, ...params, filter.limit ?? 200);
  },
  update(id: string, fields: Partial<Order>) {
    buildUpdate('orders', id, { ...fields, updated_at: nowIso() });
    return orders.require(id);
  },
  countByStatus: (projectId: string) =>
    all<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM orders WHERE project_id = ? GROUP BY status',
      projectId,
    ),
};

export const orderEvents = {
  add(orderId: string, from: string | null, to: string, actor: string, note?: string): void {
    run(
      'INSERT INTO order_events (id, order_id, from_state, to_state, actor, note, created_at) VALUES (?,?,?,?,?,?,?)',
      newId('oev'), orderId, from, to, actor, note ?? null, nowIso(),
    );
  },
  list: (orderId: string) =>
    all('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at', orderId),
};
