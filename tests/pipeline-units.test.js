import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getConfig, envKey, ROOT } from '../src/pipeline/config.js';
import { splitPromptDoc, renderPrompt, placeholders, loadPrompt } from '../src/pipeline/prompts.js';
import { ROLES, WEB_SEARCH_ROLES } from '../src/pipeline/roles.js';
import { extractJson, missingKeys } from '../src/pipeline/json.js';
import { CostTracker, priceFor, estimateTokens } from '../src/pipeline/cost.js';
import { markdownToHtml, checkStructure, locateMarkers, splitAtPaywall, markerId, stripMarkers } from '../src/pipeline/markdown.js';
import { xWeightedLength } from '../src/pipeline/xtext.js';
import { decideReview, formatFeedback } from '../src/pipeline/review.js';
import { normalizeDiagram, salvageDiagram } from '../src/pipeline/render/diagramSpec.js';
import { normalizePosts, postProblems, mixFromPatterns } from '../src/pipeline/steps/xposts.js';
import { scoreIdea } from '../src/pipeline/steps/ideas.js';
import { normalizeOutline } from '../src/pipeline/steps/article.js';
import { crc32, zipFiles } from '../src/pipeline/zip.js';
import { toZonedIso, labelJa, addDays, daysBetween } from '../src/pipeline/time.js';
import { toGenreId } from '../src/pipeline/scout.js';
import { genreStats, applyGenreDecisions, mergePatterns } from '../src/pipeline/analyze.js';
import { iconFor } from '../src/pipeline/render/icons.js';
import { DEMO_POSTS } from '../src/pipeline/providers/mockFixtures.js';
import { X_MIX, buildSlots, assignPostsToSlots, validateAssignments } from '../src/editorial/engine.js';
import { makeSlug } from '../src/pipeline/produce.js';
import { createApiHandler } from '../src/pipeline/dashboardApi.js';
import { planPosts } from '../src/pipeline/steps/xposts.js';
import { renderDiagrams } from '../src/pipeline/steps/visuals.js';
import { createAnthropicProvider } from '../src/pipeline/providers/anthropic.js';

// ── 設定 ──────────────────────────────────────
test('config: 既定値・役ごとのモデル・投稿時刻の補完', () => {
  const c = getConfig({ LLM_MODEL_X_CONVERTER: 'claude-sonnet-5', X_POSTS_PER_DAY: '4', X_POST_TIMES: '08:00' });
  assert.equal(c.provider, 'anthropic');
  assert.equal(c.model, 'claude-opus-5');
  assert.equal(c.modelFor('xConverter'), 'claude-sonnet-5');
  assert.equal(c.modelFor('writer'), 'claude-opus-5');
  assert.equal(c.costLimitUsd, 7);
  assert.equal(c.x.times.length, 4);
  assert.equal(envKey('editorInChief'), 'EDITOR_IN_CHIEF');
  assert.throws(() => getConfig({ LLM_PROVIDER: 'openai' }), /LLM_MODEL/);
  assert.throws(() => getConfig({ LLM_PROVIDER: 'gemini' }), /LLM_PROVIDER/);
});

// ── プロンプト ────────────────────────────────
test('prompts: ドキュメントの11章と prompts/ が一致している（npm run prompts で反映）', () => {
  const chapters = splitPromptDoc(fs.readFileSync(path.join(ROOT, 'docs/ai-editorial-prompts.md'), 'utf8'));
  assert.equal(chapters.length, 11);
  for (const { id, text } of chapters) assert.equal(fs.readFileSync(path.join(ROOT, 'prompts', `${id}.md`), 'utf8'), text, `${id} がドキュメントとずれています`);
  assert.deepEqual(Object.values(ROLES).map((r) => r.prompt).sort(), chapters.map((c) => c.id).sort());
});

test('prompts: 変数の差し込みと、渡し忘れの検出', () => {
  assert.equal(renderPrompt('A {{x}} B {{y}}', { x: 'あ', y: { k: 1 } }), 'A あ B {\n  "k": 1\n}');
  assert.equal(renderPrompt('{{x}}', { x: [] }), 'なし');
  assert.throws(() => renderPrompt('{{missing}}', {}), /missing/);
  assert.deepEqual(placeholders(loadPrompt('05-writer', path.join(ROOT, 'prompts'))), ['outline_json', 'research_json', 'style_guide', 'review_feedback']);
});

test('roles: Web検索を使うのはリサーチャーと校閲だけ', () => {
  assert.deepEqual(WEB_SEARCH_ROLES.sort(), ['researcher', 'reviewer']);
});

// ── JSON ─────────────────────────────────────
test('json: 前置き・コードフェンス・生の改行・末尾カンマに耐える', () => {
  assert.deepEqual(extractJson('はい。\n```json\n{"a": 1}\n```').value, { a: 1 });
  assert.deepEqual(extractJson('{"body": "1行目\n2行目", "list": [1, 2,],}').value, { body: '1行目\n2行目', list: [1, 2] });
  assert.deepEqual(extractJson('{"s": "括弧 } と { を含む"}').value, { s: '括弧 } と { を含む' });
  assert.deepEqual(extractJson('小: {"x":1} 大: {"ideas":[{"x":1}],"y":2}').value, { ideas: [{ x: 1 }], y: 2 });
  assert.equal(extractJson('{"broken": "閉じていない').ok, false);
  assert.equal(extractJson('').ok, false);
  assert.deepEqual(missingKeys({ a: 1, b: null }, ['a', 'b', 'c']), ['b', 'c']);
});

// ── 費用 ─────────────────────────────────────
test('cost: 単価・概算・上限', () => {
  assert.deepEqual(priceFor('claude-opus-5'), { input: 5, output: 25, known: true });
  assert.equal(priceFor('claude-opus-5-5').input, 4);
  assert.equal(priceFor('claude-opus-5-20260101').input, 5);
  assert.equal(priceFor('unknown-model').known, false);
  assert.deepEqual(priceFor('x', { input: 1, output: 2 }), { input: 1, output: 2, known: true });
  assert.ok(estimateTokens('日本語') >= 3 && estimateTokens('abcdefgh') <= 3);

  const logs = [];
  const cost = new CostTracker({ limitUsd: 1, log: (l) => logs.push(l) });
  const usd = cost.record('writer', { entries: [{ model: 'claude-opus-5', inputTokens: 100000, outputTokens: 10000 }], webSearches: 3 });
  assert.equal(Math.round(usd * 1e4) / 1e4, 0.5 + 0.25 + 0.03);
  assert.throws(() => cost.ensureBudget('reviewer', 0.3), (e) => e.name === 'CostLimitError');
  assert.doesNotThrow(() => cost.ensureBudget('eyecatch', 0.1));
  assert.equal(cost.summary().calls.length, 1);
  assert.ok(logs.some((l) => l.includes('累計')));
});

// ── Markdown ─────────────────────────────────
test('markdown: noteで使えるタグだけのHTMLに変換する', () => {
  const html = markdownToHtml('## 見出し\n### 小見出し\n#### さらに小\n本文**太字** <b>tag</b>\n2行目\n\n- a\n- b\n\n1. x\n\n> 引用\n\n```\n<code>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[図1]\n<<<PAYWALL>>>', {
    marker: (id) => `<p>M:${id}</p>`, paywall: () => '<p>PW</p>',
  });
  assert.match(html, /<h2>見出し<\/h2>/);
  assert.match(html, /<h3>小見出し<\/h3>\n<h3>さらに小<\/h3>/);
  assert.match(html, /<p>本文<strong>太字<\/strong> &lt;b&gt;tag&lt;\/b&gt;<br>2行目<\/p>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>x<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>引用<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>&lt;code&gt;<\/code><\/pre>/);
  assert.match(html, /<p>A｜B<br>1｜2<\/p>/);
  assert.match(html, /<p>M:図1<\/p>\n<p>PW<\/p>/);
  assert.doesNotMatch(html, /<table|<h4|<img/);
});

test('markdown: 形式チェック（マーカー1対1・有料ライン1回・コードブロック内は無視）', () => {
  const ok = checkStructure('本文\n[図1]\n```\n[図9]\n<<<PAYWALL>>>\n```\n<<<PAYWALL>>>\n［図２］', ['図1', '図2']);
  assert.deepEqual(ok.ids, ['図1', '図2']);
  assert.deepEqual(ok.issues, []);
  const ng = checkStructure('文中に[図1]がある\n[図2]\n[図2]', ['図1', '図2', '図3']);
  assert.ok(ng.issues.some((i) => i.includes('文の途中')));
  assert.ok(ng.issues.some((i) => i.includes('PAYWALL') && i.includes('0回')));
  assert.ok(ng.issues.some((i) => i.includes('[図2] が2回')));
  assert.ok(ng.issues.some((i) => i.includes('[図3]')));
  assert.equal(markerId('［図１２］'), '図12');
});

test('markdown: 位置の説明・有料ラインでの分割', () => {
  const body = '冒頭\n## 見出しA\n最初の段落です。\n[図1]\n## 見出しB\n- 箇条書きの項目\n<<<PAYWALL>>>\n有料部分';
  const pos = locateMarkers(body);
  assert.deepEqual(pos.markers['図1'], { heading: '見出しA', after: '最初の段落です。' });
  assert.deepEqual(pos.paywall, { heading: '見出しB', after: '箇条書きの項目' });
  const { free, paid } = splitAtPaywall(body);
  assert.ok(free.endsWith('- 箇条書きの項目') && paid === '有料部分');
  assert.ok(!stripMarkers(body).includes('[図1]'));
});

// ── X ────────────────────────────────────────
test('xtext: Xの文字数（日本語は2、英数は1、URLは23）', () => {
  assert.equal(xWeightedLength('あいう'), 6);
  assert.equal(xWeightedLength('abc'), 3);
  assert.equal(xWeightedLength('見て https://note.com/a/n/very-long-path-123456789'), 4 + 1 + 23);
  assert.equal(xWeightedLength('[noteのURL]'), 23);
});

test('xposts: 本数・類似・URL・長さのチェック', () => {
  const posts = normalizePosts(DEMO_POSTS);
  assert.deepEqual(postProblems(posts), []);
  const dup = normalizePosts([...DEMO_POSTS.slice(0, 6), { ...DEMO_POSTS[6], text: 'URLなしの誘導' }, { id: 'short-1', type: 'short', text: `${DEMO_POSTS[0].text} https://example.com` }]);
  assert.equal(new Set(dup.map((p) => p.id)).size, dup.length);
  const problems = postProblems(dup, [DEMO_POSTS[1].text]);
  assert.ok(problems.some((p) => p.includes('4本です')));
  assert.ok(problems.some((p) => p.includes('似すぎています')));
  assert.ok(problems.some((p) => p.includes('[noteのURL]')));
  assert.ok(problems.some((p) => p.includes('URLが入っています')));
  assert.ok(problems.some((p) => p.includes('直近の投稿')));
  assert.ok(postProblems(normalizePosts([{ id: 'short-1', type: 'short', text: 'あ'.repeat(141) }])).some((p) => p.includes('長すぎます')));
});

test('xposts: 投稿配分は合計1・導線15%以下のときだけ採用する', () => {
  assert.equal(mixFromPatterns({ x_mix: { value: 0.6, experiment: 0.2, opinion: 0.1, cta: 0.1 } })[0].ratio, 0.6);
  assert.equal(mixFromPatterns({ x_mix: { value: 0.4, experiment: 0.2, opinion: 0.1, cta: 0.3 } }), X_MIX);
  assert.equal(mixFromPatterns({}), X_MIX);
});

test('engine: 週間の枠づくりと、1日1本・誘導はnote公開後の割り当て', () => {
  const slots = buildSlots({ startDate: '2026-09-26', days: 7, times: ['07:30', '12:15', '21:00'], occupied: ['2026-09-26 07:30'] });
  assert.equal(slots.length, 20);
  assert.ok(!slots.some((s) => s.date === '2026-09-26' && s.time === '07:30'));
  const posts = normalizePosts(DEMO_POSTS);
  const { assignments, unassigned } = assignPostsToSlots(posts, slots, { notePublishAt: '2026-09-26 07:00' });
  assert.equal(unassigned.length, 0);
  assert.deepEqual(validateAssignments(assignments, posts, slots, { notePublishAt: '2026-09-26 07:00' }), []);
  const days = assignments.map((a) => slots.find((s) => s.slot_id === a.slot_id).date);
  assert.equal(new Set(days).size, 7);
  const bad = validateAssignments([{ post_id: 'cta-1', slot_id: slots[0].slot_id }, { post_id: 'short-1', slot_id: slots[0].slot_id }], posts, slots, { notePublishAt: '2026-09-30 00:00' });
  assert.ok(bad.some((p) => p.includes('2本入っています')));
  assert.ok(bad.some((p) => p.includes('note 公開前')));
  assert.ok(bad.some((p) => p.includes('割り当てられていません')));
});

// ── 校閲の判定ルール ──────────────────────────
const allPass = () => Object.fromEntries(['fact', 'no_hallucination', 'paid_value', 'free_value', 'originality', 'readability', 'ai_smell', 'claims', 'compliance', 'diagrams', 'structure'].map((k) => [k, 'pass']));

test('review: 判定ルール（AIの判定とコードのルールの厳しい方）', () => {
  assert.equal(decideReview({ verdict: 'pass', checks: allPass(), quality_score: 80 }).verdict, 'pass');
  assert.equal(decideReview({ verdict: 'pass', checks: { ...allPass(), readability: 'fail' }, quality_score: 80 }).verdict, 'pass');
  assert.equal(decideReview({ verdict: 'pass', checks: { ...allPass(), readability: 'fail', ai_smell: 'fail' }, quality_score: 80 }).verdict, 'revise');
  assert.equal(decideReview({ verdict: 'pass', checks: { ...allPass(), fact: 'fail' }, quality_score: 90 }).verdict, 'revise');
  assert.equal(decideReview({ verdict: 'human_review', checks: { ...allPass(), claims: 'fail' }, quality_score: 90 }).verdict, 'human_review');
  assert.equal(decideReview({ verdict: 'pass', checks: allPass(), quality_score: 69 }).verdict, 'revise');
  assert.equal(decideReview({ verdict: 'pass', checks: { fact: 'pass' }, quality_score: 90 }).verdict, 'revise');
  const withSystem = decideReview({ verdict: 'pass', checks: allPass(), quality_score: 90 }, ['<<<PAYWALL>>> が0回あります']);
  assert.equal(withSystem.verdict, 'revise');
  assert.match(formatFeedback(withSystem), /PAYWALL/);
});

// ── 図解JSON ─────────────────────────────────
test('diagramSpec: 形をそろえ、文字数・要素数・強調のルール違反を見つける', () => {
  const flow = normalizeDiagram({ id: '図1', type: 'flow', title: '短いタイトル', items: ['手順A', { label: '手順B', highlight: true }] });
  assert.deepEqual(flow.problems, []);
  assert.equal(flow.diagram.items[1].highlight, true);
  const long = normalizeDiagram({ type: 'steps', title: 'このタイトルは十八文字を超えてしまっています', items: Array.from({ length: 8 }, (_, i) => ({ label: `項目${i}`, highlight: true })) });
  assert.equal(long.problems.length, 3);
  const bar = normalizeDiagram({ type: 'bar_chart', title: 't', items: { unit: '分', bars: [{ label: 'A', value: '1,200' }] } });
  assert.equal(bar.diagram.items.bars[0].value, 1200);
  assert.ok(normalizeDiagram({ type: 'bar_chart', title: 't', items: { bars: [{ label: 'A', value: 'たくさん' }] } }).schemaError);
  const mx = normalizeDiagram({ type: 'matrix', title: 't', items: { points: [{ label: 'A', x: 80, y: 20 }] } });
  assert.deepEqual([mx.diagram.items.points[0].x, mx.diagram.items.points[0].y, mx.diagram.items.x_axis[0]], [0.8, 0.2, '低']);
  const cmp = normalizeDiagram({ type: 'compare', title: 't', items: { columns: ['A', 'B'], rows: [{ label: 'x', values: ['1'] }] } });
  assert.deepEqual(cmp.diagram.items.rows[0].values, ['1', '']);
  assert.ok(normalizeDiagram({ type: 'pie', title: 't', items: [] }).schemaError);
  assert.ok(normalizeDiagram({ type: 'custom', title: 't' }).schemaError);
  const salvaged = salvageDiagram({ id: '図2', title: '救済', items: { any: ['一つ目', { deep: '二つ目' }] } });
  assert.equal(salvaged.type, 'steps');
  assert.deepEqual(salvaged.items.map((i) => i.label), ['一つ目', '二つ目']);
});

// ── ネタのスコア・構成 ─────────────────────────
test('ideas: 0〜100の採点を engine.js の判定に換算する', () => {
  assert.equal(scoreIdea({ topic: 'a', scores: { search_demand: 90, x_reaction: 80, low_competition: 80, monetizability: 90 } }).verdict, 'note化');
  assert.equal(scoreIdea({ topic: 'b', scores: { search_demand: 60, x_reaction: 50, low_competition: 50, monetizability: 60 } }).verdict, 'Xでテスト');
  assert.equal(scoreIdea({ topic: 'c', scores: {} }).verdict, '見送り');
});

test('outline: 図解IDを「図N」にそろえ、重複を振り直す', () => {
  const o = normalizeOutline({ sections: [{ diagram: { id: '図1', type: 'flow' } }, { diagram: { id: '図1', type: 'compare' } }, { diagram: { type: 'steps' } }, { diagram: null }], price_yen: '980', hashtags: ['#AI', '＃図解'] }, {});
  assert.deepEqual(o.sections.map((s) => s.diagram?.id ?? null), ['図1', '図2', '図3', null]);
  assert.equal(o.price_yen, 980);
  assert.deepEqual(o.hashtags, ['AI', '図解']);
});

// ── その他 ───────────────────────────────────
test('zip: CRC32 と、展開できるZIPの作成', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const zip = zipFiles([{ name: '01.png', data: Buffer.from('abc') }, { name: '画像.png', data: Buffer.from('あいう') }]);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), 't.zip');
  fs.writeFileSync(file, zip);
  try {
    const listing = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),[(i.filename,z.read(i).decode()) for i in z.infolist()])', file], { encoding: 'utf8' });
    assert.match(listing, /None \[\('01.png', 'abc'\), \('画像.png', 'あいう'\)\]/);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
});

test('time: タイムゾーン付きの日時と表示', () => {
  assert.equal(toZonedIso('2026-09-26', '07:30', 'Asia/Tokyo'), '2026-09-26T07:30:00+09:00');
  assert.equal(labelJa('2026-09-26', '07:30'), '9/26(土) 07:30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-09-01', '2026-09-15'), 14);
});

test('scout: ジャンルIDの正規化', () => {
  assert.equal(toGenreId('AI SNS Ops!'), 'ai-sns-ops');
  assert.equal(toGenreId('日本語だけ'), '');
});

test('icons: キーワードからアイコンを選ぶ', () => {
  assert.equal(iconFor('図解'), iconFor('画像'));
  assert.notEqual(iconFor('時間'), iconFor('お金'));
  assert.ok(iconFor('該当なし'));
});

test('analyze: 検証期間が終わるまでは昇格・撤退しない', () => {
  const genres = [
    { genre_id: 'a', status: 'testing', test_started_at: '2026-09-01', test_plan: { days: 14 }, success_criteria: { note_pv: 100, x_profile_clicks: 10, paid_sales: 1 } },
    { genre_id: 'b', status: 'testing', test_started_at: '2026-09-20', test_plan: { days: 14 }, success_criteria: { note_pv: 100 } },
    { genre_id: 'c', status: 'active' },
  ];
  const records = [{ genre: 'a', noteViews: 150, profileVisits: 20, price: 980, purchases: 2, x_posts: 3 }];
  const stats = genreStats(genres, records, '2026-09-25');
  assert.equal(stats[0].test_ended, true);
  assert.equal(stats[0].meets_criteria, true);
  assert.equal(stats[1].test_ended, false);
  const { genres: next, log } = applyGenreDecisions(genres, [
    { genre_id: 'a', decision: 'promote', reason: '基準達成' },
    { genre_id: 'b', decision: 'retire', reason: '反応が弱い' },
    { genre_id: 'c', decision: 'retire', reason: '売上が2週連続で減少', lesson: '単価が低すぎた' },
  ], stats, '2026-09-25');
  assert.deepEqual(next.map((g) => g.status), ['active', 'testing', 'retired']);
  assert.equal(next[2].lesson, '単価が低すぎた');
  assert.ok(log.some((l) => l.includes('見送り')));

  const merged = mergePatterns({ patterns: [{ text: '古い' }, { text: '残す' }] }, { winning_patterns: [{ dimension: 'price', text: '新しい' }, { dimension: 'eyecatch', text: '中央に数字' }], retire_patterns: ['古い'], x_mix: { value: 0.5, experiment: 0.2, opinion: 0.2, cta: 0.1 } }, '2026-09-25');
  assert.deepEqual(merged.patterns.map((p) => p.text), ['残す', '新しい']);
  assert.deepEqual(merged.eyecatch_patterns.map((p) => p.text), ['中央に数字']);
  assert.equal(merged.x_mix.cta, 0.1);
});

// ── 見直しで追加した安全策 ─────────────────────

test('markdown: 無料記事（価格0円）では有料ラインを必須にしない', () => {
  assert.deepEqual(checkStructure('本文だけ', [], { requirePaywall: false }).issues, []);
  assert.equal(checkStructure('<<<PAYWALL>>>\n<<<PAYWALL>>>', [], { requirePaywall: false }).issues.length, 1);
});

test('produce: 手で書き換えたジャンルIDでも、一覧に出せるフォルダ名にする', () => {
  assert.match(makeSlug('2026-09-25', 'AI_Note Ops', 'topic'), /^2026-09-25_ai-note-ops-[0-9a-f]{6}$/);
  assert.match(makeSlug('2026-09-25', '日本語', 'topic'), /^2026-09-25_genre-[0-9a-f]{6}$/);
});

test('dashboard API: 標準ではこのPC以外からのアクセスを断る', async () => {
  const res = () => ({ status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b); } });
  const req = (ip) => ({ url: '/api/outputs', method: 'GET', headers: {}, socket: { remoteAddress: ip } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  const remote = res();
  await createApiHandler({ outputDir: dir })(req('192.168.1.20'), remote, () => {});
  assert.equal(remote.status, 403);
  const local = res();
  await createApiHandler({ outputDir: dir })(req('127.0.0.1'), local, () => {});
  assert.equal(local.status, 200);
  const allowed = res();
  await createApiHandler({ outputDir: dir, allowRemote: true })(req('192.168.1.20'), allowed, () => {});
  assert.equal(allowed.status, 200);
});

test('anthropic: 拒否時のフォールバックは対応モデルだけに付ける', async () => {
  const seen = [];
  const client = { messages: { stream: (p) => (seen.push('messages'), { finalMessage: async () => ({ model: 'claude-haiku-4-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: {} }) }) }, beta: { messages: { stream: () => (seen.push('beta'), null) } } };
  const provider = createAnthropicProvider(getConfig({}), { client });
  await provider.complete({ role: 'writer', model: 'claude-haiku-4-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10 });
  assert.deepEqual(seen, ['messages']);
});

test('xposts: 先の記事の投稿で枠が埋まっていたら、翌週以降に1日1本で並べる', async () => {
  const config = getConfig({ LLM_PROVIDER: 'mock' });
  const week = buildSlots({ startDate: '2026-10-01', days: 7, times: config.x.times }).map((s) => `${s.date} ${s.time}`);
  const ctx = { config, patterns: {}, log: () => {}, llm: { run: async () => ({ assignments: [] }) } };
  const x = await planPosts(ctx, { posts: normalizePosts(DEMO_POSTS), startDate: '2026-10-01', occupied: week });
  assert.equal(x.planner, 'system');
  assert.ok(x.posts.every((p) => p.slot && p.slot >= '2026-10-08'));
  assert.equal(new Set(x.posts.map((p) => p.slot.slice(0, 10))).size, 7);
});

test('visuals: テンプレートの描画に失敗しても、簡易図で最後まで作る', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-'));
  const renderer = { renderDiagram: async (d) => { if (!d.salvaged) throw new Error('template crashed'); return { overflow: [] }; } };
  const ctx = { outDir: dir, colors: {}, brand: 'b', renderer, warnings: [], log: () => {} };
  const out = await renderDiagrams(ctx, { diagrams: [{ id: '図1', type: 'flow', title: 't', items: [{ label: 'a' }] }], missing: [], specs: [], body: '' });
  assert.equal(out[0].mode, 'salvaged');
  assert.equal(ctx.warnings.length, 1);
});
