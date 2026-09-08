import { all, buildUpdate, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import { notFound } from '../../lib/errors.ts';
import type { Contract, Invoice } from '../../domain/types.ts';

export const contracts = {
  create(input: Partial<Contract> & Pick<Contract, 'kind' | 'title' | 'from_org_id' | 'to_org_id' | 'body_md'>): Contract {
    const id = input.id ?? newId('ctr');
    const ts = nowIso();
    run(
      `INSERT INTO contracts
       (id, project_id, kind, title, from_org_id, to_org_id, body_md, variables, status,
        effective_date, expire_date, signed_at, storage_path, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id ?? null, input.kind, input.title, input.from_org_id, input.to_org_id,
      input.body_md, input.variables ?? '{}', input.status ?? 'draft',
      input.effective_date ?? null, input.expire_date ?? null, input.signed_at ?? null,
      input.storage_path ?? null, ts, ts,
    );
    return contracts.require(id);
  },
  find: (id: string) => get<Contract>('SELECT * FROM contracts WHERE id = ?', id),
  require(id: string): Contract {
    const row = contracts.find(id);
    if (!row) throw notFound(`契約書が見つかりません: ${id}`);
    return row;
  },
  list: (projectId?: string) =>
    projectId
      ? all<Contract>('SELECT * FROM contracts WHERE project_id = ? ORDER BY created_at DESC', projectId)
      : all<Contract>('SELECT * FROM contracts ORDER BY created_at DESC LIMIT 200'),
  update(id: string, fields: Partial<Contract>) {
    buildUpdate('contracts', id, { ...fields, updated_at: nowIso() });
    return contracts.require(id);
  },
};

export const invoices = {
  create(input: Partial<Invoice> & Pick<Invoice, 'invoice_no' | 'direction' | 'issuer_org_id' | 'bill_to_org_id' | 'issue_date' | 'due_date'>): Invoice {
    const id = input.id ?? newId('inv');
    const ts = nowIso();
    run(
      `INSERT INTO invoices
       (id, invoice_no, direction, project_id, issuer_org_id, bill_to_org_id, issue_date, due_date,
        period_from, period_to, lines, subtotal, tax, total, withholding, payable, status, paid_at,
        storage_path, html, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.invoice_no, input.direction, input.project_id ?? null, input.issuer_org_id,
      input.bill_to_org_id, input.issue_date, input.due_date, input.period_from ?? null,
      input.period_to ?? null, input.lines ?? '[]', input.subtotal ?? 0, input.tax ?? 0,
      input.total ?? 0, input.withholding ?? 0, input.payable ?? 0, input.status ?? 'draft',
      input.paid_at ?? null, input.storage_path ?? null, input.html ?? null, ts, ts,
    );
    return invoices.require(id);
  },
  find: (id: string) => get<Invoice>('SELECT * FROM invoices WHERE id = ?', id),
  require(id: string): Invoice {
    const row = invoices.find(id);
    if (!row) throw notFound(`請求書が見つかりません: ${id}`);
    return row;
  },
  byNo: (no: string) => get<Invoice>('SELECT * FROM invoices WHERE invoice_no = ?', no),
  list(filter: { projectId?: string; direction?: string; status?: string } = {}): Invoice[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter.direction) { where.push('direction = ?'); params.push(filter.direction); }
    if (filter.status) { where.push('status = ?'); params.push(filter.status); }
    return all<Invoice>(
      `SELECT * FROM invoices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY issue_date DESC LIMIT 300`,
      ...params,
    );
  },
  update(id: string, fields: Partial<Invoice>) {
    buildUpdate('invoices', id, { ...fields, updated_at: nowIso() });
    return invoices.require(id);
  },
  /** 連番採番: YYYYMM-#### */
  nextNumber(prefix: string): string {
    const row = get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM invoices WHERE invoice_no LIKE ?",
      `${prefix}-%`,
    );
    return `${prefix}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
  },
};

export const ledger = {
  add(input: {
    project_id: string;
    date: string;
    kind: 'client_revenue' | 'media_cost' | 'ad_spend' | 'agency_margin';
    amount: number;
    counterparty_org_id?: string | null;
    memo?: string;
    ref_type?: string;
    ref_id?: string;
  }): void {
    run(
      `INSERT INTO ledger_entries (id, project_id, date, kind, counterparty_org_id, amount, memo, ref_type, ref_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      newId('led'), input.project_id, input.date, input.kind, input.counterparty_org_id ?? null,
      input.amount, input.memo ?? null, input.ref_type ?? null, input.ref_id ?? null, nowIso(),
    );
  },
  range: (projectId: string, from: string, to: string) =>
    all<{ id: string; date: string; kind: string; amount: number; memo: string | null }>(
      'SELECT * FROM ledger_entries WHERE project_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      projectId, from, to,
    ),
  totals: (projectId: string, from: string, to: string) =>
    all<{ kind: string; total: number }>(
      'SELECT kind, SUM(amount) AS total FROM ledger_entries WHERE project_id = ? AND date BETWEEN ? AND ? GROUP BY kind',
      projectId, from, to,
    ),
};
