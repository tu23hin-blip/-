import { db, queries } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return ok({ ...queries.office(db()), now: new Date().toISOString() });
  } catch (e) { return fail(e, 500); }
}
