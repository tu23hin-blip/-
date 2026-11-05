import { db, queries } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export function GET(req) {
  try {
    if (new URL(req.url).searchParams.get('summary')) {
      const c = db().prepare("SELECT COUNT(*) c FROM outputs WHERE approval = 'pending'").get().c;
      return ok({ pending: c });
    }
    return ok(queries.inbox(db()));
  } catch (e) { return fail(e, 500); }
}
