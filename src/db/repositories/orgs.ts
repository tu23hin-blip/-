import { all, buildUpdate, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import type { Advertiser, Organization, User } from '../../domain/types.ts';
import { notFound } from '../../lib/errors.ts';

export const orgs = {
  create(input: Partial<Organization> & Pick<Organization, 'kind' | 'name'>): Organization {
    const id = input.id ?? newId('org');
    const ts = nowIso();
    run(
      `INSERT INTO organizations
       (id, kind, name, legal_name, invoice_no, address, tel, contact_email, is_individual, closing_day, payment_terms, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.kind, input.name, input.legal_name ?? null, input.invoice_no ?? null,
      input.address ?? null, input.tel ?? null, input.contact_email ?? null,
      input.is_individual ?? 0, input.closing_day ?? 31, input.payment_terms ?? '翌月末', ts, ts,
    );
    return orgs.require(id);
  },
  find: (id: string) => get<Organization>('SELECT * FROM organizations WHERE id = ?', id),
  require(id: string): Organization {
    const row = orgs.find(id);
    if (!row) throw notFound(`組織が見つかりません: ${id}`);
    return row;
  },
  list: (kind?: string) =>
    kind
      ? all<Organization>('SELECT * FROM organizations WHERE kind = ? ORDER BY created_at', kind)
      : all<Organization>('SELECT * FROM organizations ORDER BY kind, created_at'),
  update(id: string, fields: Partial<Organization>) {
    buildUpdate('organizations', id, { ...fields, updated_at: nowIso() });
    return orgs.require(id);
  },
};

export const users = {
  create(input: Partial<User> & Pick<User, 'org_id' | 'email' | 'name' | 'role'>): User {
    const id = input.id ?? newId('usr');
    run(
      `INSERT INTO users (id, org_id, email, name, role, api_key_hash, active, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, input.org_id, input.email, input.name, input.role, input.api_key_hash ?? null, 1, nowIso(),
    );
    return users.require(id);
  },
  find: (id: string) => get<User>('SELECT * FROM users WHERE id = ?', id),
  require(id: string): User {
    const row = users.find(id);
    if (!row) throw notFound(`ユーザーが見つかりません: ${id}`);
    return row;
  },
  byEmail: (email: string) => get<User>('SELECT * FROM users WHERE email = ?', email),
  byApiKeyHash: (hash: string) =>
    get<User>('SELECT * FROM users WHERE api_key_hash = ? AND active = 1', hash),
  list: (orgId?: string) =>
    orgId
      ? all<User>('SELECT * FROM users WHERE org_id = ? ORDER BY created_at', orgId)
      : all<User>('SELECT * FROM users ORDER BY created_at'),
  setApiKeyHash: (id: string, hash: string) => run('UPDATE users SET api_key_hash = ? WHERE id = ?', hash, id),
};

export const advertisers = {
  create(input: Partial<Advertiser> & Pick<Advertiser, 'org_id' | 'name'>): Advertiser {
    const id = input.id ?? newId('adv');
    run(
      `INSERT INTO advertisers (id, org_id, name, product_name, category, site_url, brand_guide, ng_words, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, input.org_id, input.name, input.product_name ?? null, input.category ?? 'general',
      input.site_url ?? null, input.brand_guide ?? null, input.ng_words ?? '[]', nowIso(),
    );
    return advertisers.require(id);
  },
  find: (id: string) => get<Advertiser>('SELECT * FROM advertisers WHERE id = ?', id),
  require(id: string): Advertiser {
    const row = advertisers.find(id);
    if (!row) throw notFound(`広告主が見つかりません: ${id}`);
    return row;
  },
  list: (orgId?: string) =>
    orgId
      ? all<Advertiser>('SELECT * FROM advertisers WHERE org_id = ? ORDER BY created_at', orgId)
      : all<Advertiser>('SELECT * FROM advertisers ORDER BY created_at'),
  update(id: string, fields: Partial<Advertiser>) {
    buildUpdate('advertisers', id, fields);
    return advertisers.require(id);
  },
};
