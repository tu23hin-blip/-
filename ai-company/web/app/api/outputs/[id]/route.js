import { db, queries, recorder } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { id } = await params;
  const o = queries.outputDetail(db(), Number(id));
  return o ? ok(o) : fail('成果物が見つかりません', 404);
}

// 承認／却下／修正コメント／手動投稿URLの登録（公開そのものは人間が手動で行う）
export async function POST(req, { params }) {
  try {
    const id = Number((await params).id);
    const { action, comment, url } = await req.json();
    const r = recorder();
    if (action === 'approve') r.set_approval(id, 'approved', { comment });
    else if (action === 'reject') r.set_approval(id, 'rejected', { comment });
    else if (action === 'revise') return ok({ queued_task_id: r.request_revision(id, comment) });
    else if (action === 'publish') {
      if (!/^https?:\/\//.test(url || '')) return fail('投稿URLを https:// から入力してください');
      r.set_published(id, url);
    } else return fail('action は approve / reject / revise / publish です');
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
