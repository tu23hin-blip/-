import { db, queries } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const divisions = queries.divisionsOverview(db());
    const global = db().prepare('SELECT * FROM events WHERE division_id IS NULL ORDER BY id DESC LIMIT 5').all();
    return ok({ divisions, global_events: global, now: new Date().toISOString() });
  } catch (e) { return fail(e, 500); }
}
