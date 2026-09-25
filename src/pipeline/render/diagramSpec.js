// 図解JSONの形をそろえ、ルール違反（文字数・要素数・強調の数）を洗い出す。
// problems はAIに直してもらえる違反、schemaError はテンプレートに流し込めない形の崩れ。

export const TEMPLATE_TYPES = ['flow', 'steps', 'compare', 'checklist', 'before_after', 'bar_chart', 'matrix'];
export const LIMITS = { title: 18, label: 20, items: 7, highlights: 2 };

export const charLength = (s) => [...String(s ?? '')].length;
const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const bool = (v) => v === true || v === 'true';
const toNumber = (v) => {
  if (typeof v === 'number') return v;
  const cleaned = String(v ?? '').replace(/[,，\s]/g, '').replace(/[^\d.eE+-]/g, '');
  const n = /\d/.test(cleaned) ? Number(cleaned) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

function listItems(items) {
  const arr = Array.isArray(items) ? items : Array.isArray(items?.items) ? items.items : Array.isArray(items?.steps) ? items.steps : null;
  if (!arr?.length) return { error: 'items が空か、配列ではありません' };
  const list = arr.map((it) => (typeof it === 'string' ? { label: str(it) } : { label: str(it?.label ?? it?.text), sub: str(it?.sub), highlight: bool(it?.highlight), checked: it?.checked })).filter((it) => it.label);
  if (!list.length) return { error: 'items に label がありません' };
  return { list };
}

const NORMALIZE = {
  flow(items) {
    const { list, error } = listItems(items);
    if (error) return { error };
    const out = list.map(({ label, sub, highlight }) => ({ label, sub, highlight }));
    return { items: out, texts: out.flatMap((i) => [i.label, i.sub].filter(Boolean)), count: out.length, highlights: out.filter((i) => i.highlight).length };
  },
  steps(items) {
    return NORMALIZE.flow(items);
  },
  checklist(items) {
    const { list, error } = listItems(items);
    if (error) return { error };
    const out = list.map(({ label, checked, highlight }) => ({ label, checked: checked !== false && checked !== 'false', highlight }));
    return { items: out, texts: out.map((i) => i.label), count: out.length, highlights: out.filter((i) => i.highlight).length };
  },
  compare(items) {
    const columns = (items?.columns || []).map(str).filter(Boolean);
    const rows = (items?.rows || []).map((r) => ({ label: str(r?.label), values: (r?.values || []).map(str) })).filter((r) => r.label);
    if (!columns.length || !rows.length) return { error: 'compare には columns と rows が必要です' };
    rows.forEach((r) => {
      r.values = columns.map((_, i) => r.values[i] ?? '');
    });
    return { items: { columns, rows }, texts: [...columns, ...rows.flatMap((r) => [r.label, ...r.values])], count: rows.length, highlights: 0 };
  },
  before_after(items) {
    const before = (items?.before || []).map(str).filter(Boolean);
    const after = (items?.after || []).map(str).filter(Boolean);
    if (!before.length || !after.length) return { error: 'before_after には before と after の両方が必要です' };
    const out = { before, after, before_label: str(items.before_label) || 'Before', after_label: str(items.after_label) || 'After' };
    return { items: out, texts: [...before, ...after], count: Math.max(before.length, after.length), highlights: 0 };
  },
  bar_chart(items) {
    const bars = (items?.bars || []).map((b) => ({ label: str(b?.label), value: toNumber(b?.value), highlight: bool(b?.highlight) })).filter((b) => b.label);
    if (!bars.length || bars.some((b) => !Number.isFinite(b.value))) return { error: 'bar_chart の bars に数値でない value があります' };
    if (bars.some((b) => b.value < 0)) return { error: 'bar_chart はマイナスの値を描けません' };
    return { items: { unit: str(items.unit), bars }, texts: bars.map((b) => b.label), count: bars.length, highlights: bars.filter((b) => b.highlight).length };
  },
  matrix(items) {
    const axis = (a, lo, hi) => (Array.isArray(a) && a.length >= 2 ? [str(a[0]), str(a[1])] : [lo, hi]);
    let points = (items?.points || []).map((p) => ({ label: str(p?.label), x: toNumber(p?.x), y: toNumber(p?.y), highlight: bool(p?.highlight) })).filter((p) => p.label);
    if (!points.length || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { error: 'matrix の points に数値でない座標があります' };
    // 0〜100 で来た場合は 0〜1 に直す
    if (points.some((p) => p.x > 1 || p.y > 1)) points = points.map((p) => ({ ...p, x: p.x / 100, y: p.y / 100 }));
    points = points.map((p) => ({ ...p, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }));
    const out = { x_axis: axis(items?.x_axis, '低', '高'), y_axis: axis(items?.y_axis, '低', '高'), points };
    return { items: out, texts: points.map((p) => p.label), count: points.length, highlights: points.filter((p) => p.highlight).length };
  },
};

export function normalizeDiagram(raw) {
  const diagram = {
    id: str(raw?.id),
    type: str(raw?.type).toLowerCase(),
    title: str(raw?.title),
    subtitle: str(raw?.subtitle),
    footer: str(raw?.footer || raw?.source),
    alt_text: str(raw?.alt_text) || str(raw?.title),
    custom_html: typeof raw?.custom_html === 'string' && raw.custom_html.trim() ? raw.custom_html : null,
  };
  const problems = [];
  if (charLength(diagram.title) > LIMITS.title) problems.push(`タイトル「${diagram.title}」が${charLength(diagram.title)}文字です（${LIMITS.title}文字以内）`);
  if (diagram.type === 'custom') {
    return { diagram, problems, schemaError: diagram.custom_html ? null : 'type が custom なのに custom_html がありません' };
  }
  if (!TEMPLATE_TYPES.includes(diagram.type)) return { diagram, problems, schemaError: `テンプレートにない type「${diagram.type}」です` };
  const r = NORMALIZE[diagram.type](raw?.items);
  if (r.error) return { diagram, problems, schemaError: r.error };
  diagram.items = r.items;
  r.texts.filter((t) => charLength(t) > LIMITS.label).forEach((t) => problems.push(`「${t}」が${charLength(t)}文字です（${LIMITS.label}文字以内）`));
  if (r.count > LIMITS.items) problems.push(`要素が${r.count}個あります（最大${LIMITS.items}つ）`);
  if (r.highlights > LIMITS.highlights) problems.push(`強調（highlight）が${r.highlights}個あります（1〜${LIMITS.highlights}個まで）`);
  return { diagram, problems, schemaError: null };
}

// テンプレートにもカスタムHTMLにもできなかったときの最終手段：中の文字を拾ってステップ図にする
export function salvageDiagram(raw) {
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string' && v.trim() && texts.length < 7) texts.push(v.trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'highlight' && walk(x));
  };
  walk(raw?.items);
  const items = (texts.length ? texts : [str(raw?.title) || '図解']).map((t) => ({ label: [...t].slice(0, LIMITS.label).join('') }));
  return { ...normalizeDiagram({ ...raw, type: 'steps', items }).diagram, salvaged: true };
}
