import { recorder } from '@/lib/engine';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

// その日・その事業部に記録済みの売上と件数（フォームの初期値用）
export function GET(req) {
  try {
    const q = new URL(req.url).searchParams;
    const division = q.get('division'), date = q.get('date');
    if (!division || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail('division と date（YYYY-MM-DD）を指定してください');
    return ok(recorder().get_sales({ division, date }));
  } catch (e) { return fail(e); }
}

// 売上・販売件数の入力（事業部全体・日別）。空欄の項目は変更しない
export async function POST(req) {
  try {
    const { division, date, revenue_jpy, sales_count } = await req.json();
    if (!division) return fail('事業部を選んでください');
    if (['analyst', 'metrics'].includes(division)) return fail('分析担当・数字の取り込みには売上を入力できません');
    return ok({ ok: true, saved: recorder().record_sales({ division, date, revenue_jpy, sales_count }) });
  } catch (e) { return fail(e); }
}
