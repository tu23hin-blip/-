import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32 (紛らわしい文字を除去)

/** 時系列ソート可能なID。prefix でエンティティ種別が読めるようにする。 */
export function newId(prefix: string): string {
  const now = Date.now();
  let ts = '';
  let n = now;
  for (let i = 0; i < 10; i++) {
    ts = ALPHABET.charAt(n % 32) + ts;
    n = Math.floor(n / 32);
  }
  const rand = randomBytes(8);
  let suffix = '';
  for (const byte of rand) suffix += ALPHABET.charAt(byte % 32);
  return `${prefix}_${ts}${suffix}`;
}

export const uuid = (): string => randomUUID();

export function apiKey(): string {
  return `sk_asp_${randomBytes(24).toString('base64url')}`;
}
