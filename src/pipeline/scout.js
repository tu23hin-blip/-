// npm run scout … ① ジャンル探索。候補を testing として data/genres.json に追加する（既存のジャンルは変更しない）
import { LLM } from './llm.js';
import { fmtUsd } from './cost.js';
import { Store } from './store.js';
import { collectTrends } from './trends.js';
import { todayIn } from './time.js';
import { summarizeGenre } from './steps/ideas.js';
import { DEFAULT_STYLE_GUIDE } from './steps/article.js';
import { createCost } from './produce.js';

const DEFAULT_TEST_PLAN = { x_posts: 10, free_notes: 2, paid_notes: 1, days: 14 };

export const toGenreId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function scout({ config, count = 3, log = console.log, now = new Date() }) {
  const store = new Store(config.paths.data);
  const cost = createCost(config, log);
  const llm = await LLM.create(config, { cost, log });
  const genres = store.genres();
  log(`AI編集部：ジャンル探索（${count}件）`);

  const out = await llm.run('genreScout', {
    genres_json: genres.map(summarizeGenre),
    trend_digest: await collectTrends({ config, store, log }),
    operator_profile: store.readText('operator.md') || 'なし（data/operator.md に得意分野・経験を書いてください）',
    count: String(count),
  });

  const today = todayIn(config.timezone, now);
  const added = [];
  const skipped = [];
  const next = [...genres];
  for (const c of (Array.isArray(out.candidates) ? out.candidates : []).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))) {
    const id = toGenreId(c.genre_id || c.name) || `genre-${next.length + 1}`;
    if (next.some((g) => g.genre_id === id)) {
      skipped.push(id);
      continue;
    }
    const genre = {
      genre_id: id,
      name: String(c.name || id),
      status: 'testing',
      target_reader: c.target_reader || '',
      why_pay: c.why_pay || '',
      experiment_angle: c.experiment_angle || '',
      paid_assets: c.paid_assets || [],
      sample_titles: c.sample_titles || [],
      sample_x_hooks: c.sample_x_hooks || [],
      risk: c.risk || '',
      needs_separate_account: Boolean(c.needs_separate_account),
      priority: c.priority ?? null,
      test_plan: { ...DEFAULT_TEST_PLAN, ...(c.test_plan || {}) },
      success_criteria: { is_provisional: true, ...(c.success_criteria || {}) },
      magazine: String(c.name || id),
      brand: 'AI編集部',
      colors: store.nextPalette(),
      style_guide: DEFAULT_STYLE_GUIDE,
      test_started_at: today,
      created_at: today,
      source: 'genreScout',
    };
    next.push(genre);
    store.saveGenres(next);
    added.push(genre);
  }
  store.appendLog('scout_log.jsonl', [{ at: now.toISOString(), candidates: out.candidates, added: added.map((g) => g.genre_id), skipped }]);

  added.forEach((g) => log(`＋ ${g.genre_id}「${g.name}」を testing で追加${g.needs_separate_account ? '（別アカウント向け）' : ''}`));
  skipped.forEach((id) => log(`・${id} は登録済みのため追加しませんでした`));
  log(`費用：${fmtUsd(cost.summary().total_usd)}`);
  return { added, skipped, cost: cost.summary() };
}
