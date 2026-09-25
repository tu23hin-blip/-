// ③〜⑥・⑨ リサーチ → 構成 → 本文 → 図解JSON → 校閲。不合格なら指摘を戻して最大2回書き直す
import { LLMOutputError } from '../errors.js';
import { checkStructure, diagramNumber } from '../markdown.js';
import { normalizeDiagram } from '../render/diagramSpec.js';
import { decideReview, formatFeedback, MAX_REWRITES } from '../review.js';
import { canAffordRewrite } from '../estimate.js';

export const DEFAULT_STYLE_GUIDE = 'です・ます調。専門用語は最初に一言で説明する。数字は実測値かリサーチ結果にあるものだけを使い、例として出す数字には「例」と明記する。';

const ideaForPrompt = (idea) => {
  const { score_total, verdict, proven_on_x, ...rest } = idea;
  return rest;
};

export async function research(ctx, idea) {
  const out = await ctx.llm.run('researcher', {
    idea_json: ideaForPrompt(idea),
    research_questions: idea.research_questions || [],
    experiment_data: ctx.store.experimentData(idea.genre_id) || 'なし',
  });
  // 事実にIDを振って、ライターの used_fact_ids と対応させる
  out.facts = (Array.isArray(out.facts) ? out.facts : []).map((f, i) => ({ id: `F${i + 1}`, ...f }));
  return out;
}

// 図解IDを「図N」にそろえ、重複を振り直す
export function normalizeOutline(outline, idea) {
  const used = new Set();
  let next = 0;
  const sections = (Array.isArray(outline.sections) ? outline.sections : []).map((s) => {
    if (!s?.diagram?.type) return { ...s, diagram: null };
    let id = diagramNumber(s.diagram.id) ? `図${diagramNumber(s.diagram.id)}` : null;
    if (!id || used.has(id)) {
      do next += 1; while (used.has(`図${next}`));
      id = `図${next}`;
    }
    used.add(id);
    return { ...s, diagram: { ...s.diagram, id } };
  });
  const price = Math.round(Number(outline.price_yen) || Number(idea?.suggested_price_yen) || 0);
  return {
    ...outline,
    sections,
    price_yen: Math.max(0, price),
    hashtags: (Array.isArray(outline.hashtags) ? outline.hashtags : []).map((t) => String(t).replace(/^[#＃]/, '').trim()).filter(Boolean).slice(0, 10),
  };
}

export const diagramSpecs = (outline) => outline.sections.filter((s) => s.diagram).map((s) => ({ ...s.diagram, section: s.heading, part: s.part }));

export async function makeOutline(ctx, idea, researchJson) {
  const out = await ctx.llm.run('outliner', { idea_json: ideaForPrompt(idea), research_json: researchJson, winning_patterns: ctx.patterns.patterns });
  return normalizeOutline(out, idea);
}

// 本文にあるマーカーに合わせて図解の指定をそろえる（構成にない図が書かれていたら中身は図解役に任せる）
function specsForBody(specs, ids) {
  return ids.map((id) => specs.find((s) => s.id === id) || { id, type: 'おまかせ', purpose: '本文のこの位置の内容を1枚で伝える' });
}

function collectDiagrams(rawList, specs) {
  const byId = new Map();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const id = diagramNumber(raw?.id) ? `図${diagramNumber(raw.id)}` : null;
    if (id && !byId.has(id)) byId.set(id, raw);
  }
  const result = { diagrams: [], problems: [], missing: [] };
  for (const spec of specs) {
    const raw = byId.get(spec.id);
    if (!raw) {
      result.missing.push(spec.id);
      continue;
    }
    const { diagram, problems, schemaError } = normalizeDiagram({ ...raw, id: spec.id });
    result.diagrams.push({ ...diagram, schema_error: schemaError || null });
    problems.forEach((p) => result.problems.push(`${spec.id}: ${p}`));
    if (schemaError) result.problems.push(`${spec.id}: ${schemaError}`);
  }
  result.missing.forEach((id) => result.problems.push(`${id} の図解がありません`));
  return result;
}

// ⑥ 図解JSON。ルール違反があれば1回だけ直してもらい、残った違反は注意事項として記録する
export async function makeDiagramSpecs(ctx, { body, specs }) {
  if (!specs.length) return { diagrams: [], problems: [], missing: [] };
  const vars = { body_markdown: body, diagram_specs: specs, brand_colors: ctx.colors };
  let result = collectDiagrams((await ctx.llm.run('diagrammer', vars)).diagrams, specs);
  if (result.problems.length) {
    ctx.log(`   ⚠ 図解のルール違反 ${result.problems.length}件 → 1回だけ直してもらいます`);
    const fix = `前回の出力に次の問題がありました。すべて直したうえで、全部の図解を出力し直してください。\n${result.problems.map((p) => `- ${p}`).join('\n')}`;
    result = collectDiagrams((await ctx.llm.run('diagrammer', vars, { extraInstruction: fix })).diagrams, specs);
  }
  return result;
}

export async function writeAndReview(ctx, { idea, researchJson, outline }) {
  const specs = diagramSpecs(outline);
  const expectedIds = specs.map((s) => s.id);
  let feedback = 'なし（初回）';
  const rounds = [];
  let article;
  let diagrams;
  let decision;
  let review;
  for (let round = 0; ; round += 1) {
    article = await ctx.llm.run('writer', {
      outline_json: outline,
      research_json: researchJson,
      style_guide: ctx.genre.style_guide || DEFAULT_STYLE_GUIDE,
      review_feedback: feedback,
    });
    article.title = String(article.title || outline.title_candidates?.[0] || idea.topic).trim();
    article.body_markdown = String(article.body_markdown || '').trim();
    const structure = checkStructure(article.body_markdown, expectedIds, { requirePaywall: outline.price_yen > 0 });
    diagrams = await makeDiagramSpecs(ctx, { body: article.body_markdown, specs: specsForBody(specs, structure.ids) });

    try {
      review = await ctx.llm.run('reviewer', {
        article_json: { title: article.title, price_yen: outline.price_yen, body_markdown: article.body_markdown },
        research_json: researchJson,
        diagrams_json: diagrams.diagrams,
        recent_summaries: ctx.recent.map((r) => ({ title: r.meta.title, lead: r.meta.lead })),
      });
    } catch (e) {
      if (!(e instanceof LLMOutputError)) throw e;
      review = { verdict: 'human_review', checks: {}, issues: [], quality_score: null, notes_for_human: '校閲の結果を読み取れなかったため、人間の確認が必要です。' };
    }
    decision = decideReview(review, structure.issues);
    rounds.push({ round: round + 1, verdict: decision.verdict, quality_score: decision.quality_score, reasons: decision.reasons, issues: decision.issues, changes: article.changes || [] });
    ctx.save(`05-article-round${round + 1}.json`, { article, diagrams, review, decision });
    const label = { pass: '合格', revise: '書き直し', human_review: '要確認' }[decision.verdict];
    ctx.log(`   校閲 ${round + 1}回目：${label}（スコア ${decision.quality_score ?? '不明'}）${decision.reasons.length ? `｜${decision.reasons.join('、')}` : ''}`);

    if (decision.verdict !== 'revise') break;
    if (round >= MAX_REWRITES) {
      decision.reasons.push(`${MAX_REWRITES}回書き直しても合格しませんでした`);
      break;
    }
    if (!canAffordRewrite(ctx.config, ctx.cost)) {
      decision.reasons.push('費用の上限に近いため書き直しを打ち切りました');
      break;
    }
    feedback = formatFeedback(decision);
  }
  return {
    article,
    diagrams,
    review,
    decision,
    rounds,
    finalStatus: decision.verdict === 'pass' ? 'ready' : 'needs_review',
  };
}
