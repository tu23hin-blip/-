import { db, queries, recorder } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { slug } = await params;
  const d = queries.divisionDetail(db(), slug);
  if (!d) return fail('事業部が見つかりません', 404);
  return ok({ ...d, now: new Date().toISOString() });
}

// 人間による一時停止／再開
export async function POST(req, { params }) {
  try {
    const { slug } = await params;
    const { action } = await req.json();
    if (action === 'pause') recorder().set_division_status(slug, 'paused', '画面から一時停止');
    else if (action === 'resume') recorder().set_division_status(slug, 'active', '画面から再開');
    else return fail('action は pause / resume です');
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
