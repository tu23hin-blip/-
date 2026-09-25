// ② 編集長：ネタ候補を出させ、engine.js のスコアで「note化 / Xでテスト / 見送り」を判定する
import { scoreTopic } from '../../editorial/engine.js';

const to10 = (v) => Math.max(0, Math.min(10, (Number(v) || 0) / 10));

// AIの採点（0〜100）を engine.js の入力（0〜10、competition は競合の多さ）に換算する
export function scoreIdea(idea) {
  const s = idea.scores || {};
  const scored = scoreTopic({
    name: idea.topic,
    search: to10(s.search_demand),
    xReaction: to10(s.x_reaction),
    competition: 10 - to10(s.low_competition),
    monetizable: to10(s.monetizability),
  });
  return { ...idea, score_total: scored.total, verdict: scored.verdict, proven_on_x: scored.provenOnX };
}

// プロンプトに渡すジャンル情報（配色や文体ガイドなど、判断に要らない項目は省く）
export function summarizeGenre(g) {
  const keys = ['genre_id', 'name', 'status', 'target_reader', 'why_pay', 'experiment_angle', 'paid_assets', 'needs_separate_account', 'test_plan', 'success_criteria', 'test_started_at', 'stats', 'retired_reason', 'lesson'];
  return Object.fromEntries(keys.filter((k) => g[k] !== undefined).map((k) => [k, g[k]]));
}

export async function chooseIdea(ctx, { genre, force }) {
  const { llm, store, log } = ctx;
  // 自動選択では、別アカウント向けのジャンルは選ばない（同じアカウントで世界観がぶれるのを防ぐ）
  const candidates = store.genres().filter((g) => g.status !== 'retired' && (genre ? g.genre_id === genre.genre_id : !g.needs_separate_account));
  if (!candidates.length) throw new Error('選べるジャンルがありません（data/genres.json に active か testing のジャンルを登録してください）');

  const out = await llm.run('editorInChief', {
    genre: genre ? summarizeGenre(genre) : '未指定（active と testing から選んでください）',
    genres_json: store.genres().filter((g) => g.status !== 'retired').map(summarizeGenre),
    winning_patterns: ctx.patterns.patterns,
    recent_titles: ctx.recent.map((r) => r.meta.title),
    x_test_results: store.xTests().filter((t) => t.metrics && Object.keys(t.metrics).length),
    trend_digest: ctx.trends,
  });

  const ideas = (Array.isArray(out.ideas) ? out.ideas : [])
    .filter((i) => i && i.topic)
    .map((i) => scoreIdea(genre ? { ...i, genre_id: genre.genre_id } : i))
    .sort((a, b) => b.score_total - a.score_total);
  ideas.forEach((i) => log(`   ・${i.score_total}点 ${i.verdict}｜${i.topic}（${i.genre_id}）`));

  const at = new Date().toISOString();
  store.appendLog('ideas.jsonl', ideas.map((i) => ({ at, ...i })));
  // 「Xでテスト」のネタは data/x_tests.json に積んでおく（反応が良ければ次回以降の note 化候補になる）
  const tests = store.xTests();
  const newTests = ideas.filter((i) => i.verdict === 'Xでテスト' && !tests.some((t) => t.topic === i.topic));
  if (newTests.length) store.saveXTests([...tests, ...newTests.map((i) => ({ created_at: at, genre_id: i.genre_id, topic: i.topic, angle: i.angle, status: 'pending', metrics: {} }))]);

  const usable = ideas.filter((i) => candidates.some((g) => g.genre_id === i.genre_id));
  const pick = usable.find((i) => i.verdict === 'note化') || (force ? usable[0] : null);
  return { pick: pick || null, ideas };
}
