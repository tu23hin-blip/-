import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.ts';
import { users } from '../db/repositories/orgs.ts';
import { apiKey as generateKey } from '../lib/id.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';
import type { User, UserRole } from '../domain/types.ts';

/** APIキーは平文保存しない。作成時に一度だけ返し、DB には SHA-256 のみ置く。 */
export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

export function issueApiKey(userId: string): string {
  const key = generateKey();
  users.setApiKeyHash(userId, hashKey(key));
  return key;
}

export type Principal = {
  kind: 'bootstrap' | 'user';
  user?: User;
  role: UserRole;
  orgId: string | null;
};

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function authenticate(headers: Record<string, string | string[] | undefined>): Principal {
  const raw = headers['authorization'] ?? headers['x-api-key'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw unauthorized();
  const key = header.replace(/^Bearer\s+/i, '').trim();
  if (!key) throw unauthorized();

  if (config.bootstrapApiKey && constantTimeEqual(key, config.bootstrapApiKey)) {
    return { kind: 'bootstrap', role: 'owner', orgId: null };
  }

  const user = users.byApiKeyHash(hashKey(key));
  if (!user) throw unauthorized('APIキーが無効です');
  return { kind: 'user', user, role: user.role, orgId: user.org_id };
}

const RANK: Record<UserRole, number> = {
  owner: 100, admin: 80, legal: 60, operator: 50, viewer: 10, system: 90,
};

export function requireRole(principal: Principal, minimum: UserRole): void {
  if (RANK[principal.role] < RANK[minimum]) {
    throw forbidden(`この操作には ${minimum} 以上の権限が必要です`);
  }
}
