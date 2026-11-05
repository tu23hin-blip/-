import { db, queries } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export function GET(req) {
  try {
    const days = Number(new URL(req.url).searchParams.get('days')) || 30;
    if (![7, 30, 90].includes(days)) return fail('days は 7 / 30 / 90 のどれかです');
    return ok(queries.dashboard(db(), { days }));
  } catch (e) { return fail(e, 500); }
}
