// ⑩ note1本からX投稿7本、⑪ 週間の投稿枠への割り当て
import { REPURPOSE_SET, X_MIX, buildSlots, assignPostsToSlots, validateAssignments, findNearDuplicates, similarity } from '../../editorial/engine.js';
import { splitAtPaywall, stripMarkers } from '../markdown.js';
import { X_LIMIT, NOTE_URL_PLACEHOLDER, xWeightedLength, hasUrl } from '../xtext.js';
import { addDays, labelJa, toZonedIso, todayIn } from '../time.js';

const DUPLICATE_THRESHOLD = 0.6;
const TYPE_INFO = Object.fromEntries(REPURPOSE_SET.map((r) => [r.type, r]));
const CATEGORIES = ['value', 'experiment', 'opinion', 'cta'];

export function normalizePosts(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => p && String(p.text || '').trim())
    .map((p) => {
      const type = TYPE_INFO[p.type] ? p.type : 'short';
      let id = String(p.id || '').trim() || `${type}-1`;
      for (let n = 1; seen.has(id); n += 1) id = `${type}-${n}`;
      seen.add(id);
      const category = type === 'cta' ? 'cta' : CATEGORIES.includes(p.category) && p.category !== 'cta' ? p.category : TYPE_INFO[type].category;
      return { id, type, label: TYPE_INFO[type].label, category, hook_type: String(p.hook_type || '').trim(), text: String(p.text).trim(), source_heading: String(p.source_heading || '').trim() };
    });
}

// ルール違反を列挙する。recentPosts は直近30日に作った投稿の本文
export function postProblems(posts, recentPosts = []) {
  const problems = [];
  for (const { type, count, label } of REPURPOSE_SET) {
    const n = posts.filter((p) => p.type === type).length;
    if (n !== count) problems.push(`${label}（${type}）が${n}本です（${count}本にしてください）`);
  }
  findNearDuplicates(posts, DUPLICATE_THRESHOLD).forEach(({ a, b, score }) => problems.push(`${a} と ${b} が似すぎています（類似度 ${score}）。書き出しと構成を変えてください`));
  for (const p of posts) {
    const len = xWeightedLength(p.text);
    if (p.type !== 'long' && len > X_LIMIT) problems.push(`${p.id} が長すぎます（Xの文字数 ${len}/${X_LIMIT}）`);
    if (p.type === 'cta' && !p.text.includes(NOTE_URL_PLACEHOLDER)) problems.push(`${p.id} に ${NOTE_URL_PLACEHOLDER} がありません`);
    if (p.type !== 'cta' && hasUrl(p.text)) problems.push(`${p.id} にURLが入っています（URLは cta だけ）`);
    const close = recentPosts.find((r) => similarity(p.text, r) >= DUPLICATE_THRESHOLD);
    if (close) problems.push(`${p.id} が直近の投稿「${close.slice(0, 20)}…」と似すぎています`);
  }
  return problems;
}

export async function convertToPosts(ctx, { title, body, outline, recentPosts }) {
  const vars = {
    title,
    free_body: stripMarkers(splitAtPaywall(body).free),
    paid_preview: outline.paid_preview || 'なし',
    winning_patterns: ctx.patterns.patterns,
    recent_posts: recentPosts.slice(0, 30),
    fix_notes: 'なし（初回）',
  };
  let posts = normalizePosts((await ctx.llm.run('xConverter', vars)).posts);
  let problems = postProblems(posts, recentPosts);
  if (problems.length) {
    ctx.log(`   ⚠ X投稿の問題 ${problems.length}件 → 1回だけ作り直してもらいます`);
    const retry = normalizePosts((await ctx.llm.run('xConverter', { ...vars, fix_notes: problems.map((p) => `- ${p}`).join('\n') })).posts);
    if (retry.length) posts = retry;
    problems = postProblems(posts, recentPosts);
  }
  // 誘導投稿にURLの差し込み位置がなければ末尾に足す
  posts.filter((p) => p.type === 'cta' && !p.text.includes(NOTE_URL_PLACEHOLDER)).forEach((p) => {
    p.text = `${p.text}\n\n${NOTE_URL_PLACEHOLDER}`;
  });
  const dupIds = new Set(findNearDuplicates(posts, DUPLICATE_THRESHOLD).flatMap((d) => [d.a, d.b]));
  return {
    posts: posts.map((p) => {
      const length = xWeightedLength(p.text);
      const warnings = [];
      if (dupIds.has(p.id)) warnings.push('ほかの投稿と似ています。投稿前に書き分けてください');
      if (length > X_LIMIT) warnings.push(p.type === 'long' ? `${X_LIMIT}文字（Xの数え方）を超えるため、長文投稿（X Premium）が必要です` : `Xの文字数 ${length}/${X_LIMIT} を超えています。短くしてください`);
      return { ...p, x_length: length, warnings };
    }),
    problems,
  };
}

export function mixFromPatterns(patterns) {
  const m = patterns?.x_mix;
  if (!m) return X_MIX;
  const mix = X_MIX.map((x) => ({ ...x, ratio: Number(m[x.key]) }));
  const sum = mix.reduce((s, x) => s + (Number.isFinite(x.ratio) ? x.ratio : NaN), 0);
  const cta = mix.find((x) => x.key === 'cta').ratio;
  return Math.abs(sum - 1) < 0.02 && cta <= 0.15 && mix.every((x) => x.ratio >= 0) ? mix : X_MIX;
}

export async function planPosts(ctx, { posts, startDate, occupied }) {
  const { config } = ctx;
  const start = startDate || addDays(todayIn(config.timezone), 1);
  const mix = mixFromPatterns(ctx.patterns);
  // 先に作った記事の投稿で枠が埋まっていたら、1日1本で並べられるまで期間を延ばす
  let slots = [];
  for (const days of [7, 14, 21, 28]) {
    slots = buildSlots({ startDate: start, days, times: config.x.times, mix, occupied });
    if (new Set(slots.map((s) => s.date)).size >= posts.length) break;
  }
  const notePublishAt = `${start} ${config.x.notePublishTime}`;

  let assignments = null;
  let notes = '';
  let source = 'ai';
  const out = await ctx.llm.run('xPlanner', {
    posts_json: posts.map(({ id, type, category, hook_type, text }) => ({ id, type, category, hook_type, text: text.slice(0, 80) })),
    slots_json: slots.map(({ slot_id, date, time, category }) => ({ slot_id, date, weekday: labelJa(date).slice(-2, -1), time, category })),
    note_publish_at: notePublishAt,
    time_performance: ctx.patterns.time_performance || 'なし',
    mix_policy: mix.map((m) => `${m.label} ${Math.round(m.ratio * 100)}%`).join(' / '),
  });
  const problems = validateAssignments(out.assignments, posts, slots, { notePublishAt });
  if (problems.length) {
    ctx.log(`   ⚠ 割り当てにルール違反（${problems.slice(0, 3).join('、')}${problems.length > 3 ? ' ほか' : ''}）→ システムの割り当てを使います`);
    ({ assignments } = assignPostsToSlots(posts, slots, { notePublishAt }));
    source = 'system';
  } else {
    assignments = out.assignments;
    notes = String(out.notes || '');
  }

  const slotById = Object.fromEntries(slots.map((s) => [s.slot_id, s]));
  const reasonById = Object.fromEntries((out.assignments || []).map((a) => [a.post_id, a.reason]));
  const scheduled = posts
    .map((p) => {
      const a = assignments.find((x) => x.post_id === p.id);
      const s = a && slotById[a.slot_id];
      if (!s) return { ...p, slot: null, recommended_at: null, recommended_label: '未定（空き枠なし）', reason: '' };
      return {
        ...p,
        slot: `${s.date} ${s.time}`,
        recommended_at: toZonedIso(s.date, s.time, config.timezone),
        recommended_label: labelJa(s.date, s.time),
        slot_category: s.category,
        reason: source === 'ai' ? String(reasonById[p.id] || '') : 'カテゴリ・曜日のバランスで自動割り当て',
      };
    })
    .sort((a, b) => String(a.slot || '9').localeCompare(String(b.slot || '9')));
  return {
    note_publish_at: toZonedIso(start, config.x.notePublishTime, config.timezone),
    note_publish_label: labelJa(start, config.x.notePublishTime),
    posts: scheduled,
    planner: source,
    notes,
  };
}
