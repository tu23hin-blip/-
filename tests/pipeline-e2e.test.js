// 実際に produce / scout / analyze を mock（APIを使わない）で動かし、完成品一式と画像を確認する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { getConfig, ROOT } from '../src/pipeline/config.js';
import { produce } from '../src/pipeline/produce.js';
import { scout } from '../src/pipeline/scout.js';
import { analyze } from '../src/pipeline/analyze.js';
import { loadOutput, saveStatus } from '../src/pipeline/outputs.js';
import { Store } from '../src/pipeline/store.js';
import { Renderer } from '../src/pipeline/render/renderer.js';
import { renderDiagrams } from '../src/pipeline/steps/visuals.js';
import { renderSamples } from '../src/pipeline/samples.js';
import { createApiHandler } from '../src/pipeline/dashboardApi.js';

const chromiumPath = process.env.CHROMIUM_PATH || undefined;
const canRender = await chromium.launch({ executablePath: chromiumPath }).then((b) => b.close().then(() => true), () => false);
const needsBrowser = canRender ? {} : { skip: 'Chromium を起動できないため省略（npx playwright install chromium を実行してください）' };

function sandbox(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-'));
  fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  const config = getConfig({ LLM_PROVIDER: 'mock', EDITORIAL_DATA_DIR: path.join(dir, 'data'), EDITORIAL_OUTPUT_DIR: path.join(dir, 'output'), CHROMIUM_PATH: chromiumPath || '', ...env });
  return { dir, config };
}
const quiet = () => {};
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 1, 4), 'PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

let shared; // 最初の制作結果（ダッシュボードAPIのテストでも使う）

test('produce: 1本まるごと制作し、output/ に完成品一式が出る', needsBrowser, async () => {
  const { config } = sandbox();
  const r = await produce({ config, genreId: 'ai-note-automation', startDate: '2026-10-01', log: quiet });
  shared = { config, r };
  assert.equal(r.status, 'ready');
  const files = ['note_body.html', 'note_body.md', 'eyecatch.png', 'meta.json', 'x_posts.json', 'x_posts.md', 'publish_checklist.md', 'images/01.png', 'images/02.png', 'images/03.png', 'images/04.png'];
  files.forEach((f) => assert.ok(fs.existsSync(path.join(r.outDir, f)), `${f} がありません`));
  assert.match(path.basename(r.outDir), /^\d{4}-\d{2}-\d{2}_ai-note-automation-[0-9a-f]{6}$/);
  for (let i = 1; i <= 4; i++) assert.deepEqual(pngSize(path.join(r.outDir, `images/0${i}.png`)), [1280, 720]);
  assert.deepEqual(pngSize(path.join(r.outDir, 'eyecatch.png')), [1280, 670]);

  const meta = JSON.parse(fs.readFileSync(path.join(r.outDir, 'meta.json'), 'utf8'));
  assert.equal(meta.price_yen, 980);
  assert.equal(meta.review.final_status, 'ready');
  assert.equal(meta.paywall.heading, '実際にやってみた結果（デモ用の架空データ）');
  assert.deepEqual(meta.images.map((i) => [i.id, i.file, i.mode]), [['図1', 'images/01.png', 'template'], ['図2', 'images/02.png', 'template'], ['図3', 'images/03.png', 'template'], ['図4', 'images/04.png', 'template']]);
  assert.equal(meta.demo, true);
  assert.ok(meta.hashtags.every((t) => t.startsWith('#')));

  const html = fs.readFileSync(path.join(r.outDir, 'note_body.html'), 'utf8');
  assert.equal((html.match(/【図\d+をここに挿入】/g) || []).length, 4);
  assert.match(html, /【ここに有料ラインを引く】ここから下が有料エリアです（¥980）/);
  const md = fs.readFileSync(path.join(r.outDir, 'note_body.md'), 'utf8');
  assert.match(md, /!\[図1：.+\]\(images\/01\.png\)/);

  const x = JSON.parse(fs.readFileSync(path.join(r.outDir, 'x_posts.json'), 'utf8'));
  assert.equal(x.posts.length, 7);
  assert.equal(x.note_publish_at, '2026-10-01T07:00:00+09:00');
  assert.ok(x.posts.every((p) => /^2026-10-0[1-7]T\d{2}:\d{2}:00\+09:00$/.test(p.recommended_at)));
  const cta = x.posts.find((p) => p.type === 'cta');
  assert.ok(cta.recommended_at > x.note_publish_at && cta.text.includes('[noteのURL]'));
  assert.equal(new Set(x.posts.map((p) => p.recommended_at.slice(0, 10))).size, 7, '1日1本ずつ散らす');

  const checklist = fs.readFileSync(path.join(r.outDir, 'publish_checklist.md'), 'utf8');
  assert.match(checklist, /価格を ¥980 に設定する/);
  assert.match(checklist, /\| 図1 \| images\/01\.png \|/);
  assert.match(checklist, /マガジン「AI編集部 実験ログ」/);
  assert.equal(loadOutput(config.paths.output, r.slug).state, 'ready');

  const store = new Store(config.paths.data);
  assert.ok(store.xTests().some((t) => t.topic === 'AIに書かせたX投稿の伸びた型'), 'Xでテストのネタが保存される');
  assert.ok(fs.readFileSync(store.file('ideas.jsonl'), 'utf8').includes('noteの図解づくり'));
});

test('produce: 不合格なら書き直し、2回目で合格すれば投稿待ち', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'revise_once' });
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  assert.equal(r.status, 'ready');
  assert.equal(r.meta.review.rounds, 2);
  assert.equal(r.meta.review.history[0].verdict, 'revise');
});

test('produce: 2回書き直しても不合格なら「要確認」', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'always_revise' });
  const r = await produce({ config, genreId: 'ai-ad-creative', log: quiet });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.meta.review.rounds, 3);
  assert.match(fs.readFileSync(path.join(r.outDir, 'publish_checklist.md'), 'utf8'), /要確認/);
  assert.equal(loadOutput(config.paths.output, r.slug).state, 'needs_review');
  const colors = JSON.parse(fs.readFileSync(path.join(config.paths.data, 'genres.json'), 'utf8')).genres.find((g) => g.genre_id === 'ai-ad-creative').colors;
  assert.equal(colors.primary, '#0f8b8d');
});

test('produce: 直せない問題（human_review）は書き直さずに「要確認」', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'human_review' });
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.meta.review.rounds, 1);
});

test('produce: どの役のJSONが壊れても、1回の出し直しで最後まで作れる', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'bad_json_once' });
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  assert.equal(r.status, 'ready');
  const runLog = fs.readFileSync(path.join(r.outDir, 'work', 'run_log.txt'), 'utf8');
  assert.equal((runLog.match(/1回だけ出し直しを依頼します/g) || []).length, 9);
});

test('produce: ルール違反は1回だけ直させ、割り当てが不正ならシステムが割り当てる', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'long_labels_once,dup_posts_once,bad_plan' });
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  assert.equal(r.status, 'ready');
  const runLog = fs.readFileSync(path.join(r.outDir, 'work', 'run_log.txt'), 'utf8');
  assert.match(runLog, /図解のルール違反 1件/);
  assert.match(runLog, /X投稿の問題/);
  assert.match(runLog, /システムの割り当てを使います/);
  assert.equal(r.meta.x.planner, 'system');
});

test('produce: note化できるネタがなければ作らない（--force なら作る）', needsBrowser, async () => {
  const { config } = sandbox({ MOCK_SCENARIO: 'no_idea' });
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  assert.equal(r.status, 'no_idea');
  assert.ok(!fs.existsSync(config.paths.output));
  const forced = await produce({ config, genreId: 'ai-note-automation', force: true, log: quiet });
  assert.equal(forced.status, 'ready');
});

test('produce: --auto では編集長がジャンルを選ぶ', needsBrowser, async () => {
  const { config } = sandbox();
  const r = await produce({ config, auto: true, log: quiet });
  assert.equal(r.meta.genre.genre_id, 'ai-note-automation');
});

test('produce: 費用の概算が上限を超えるなら、APIを呼ぶ前に止める', async () => {
  const { config } = sandbox({ LLM_PRICE_INPUT_PER_MTOK: '1000', LLM_PRICE_OUTPUT_PER_MTOK: '1000', COST_LIMIT_PER_RUN: '1' });
  await assert.rejects(produce({ config, genreId: 'ai-note-automation', log: quiet }), (e) => e.name === 'CostLimitError');
  assert.ok(!fs.existsSync(config.paths.output));
});

test('produce: 未登録・撤退済みのジャンルは止める', async () => {
  const { config } = sandbox();
  await assert.rejects(produce({ config, genreId: 'nope', log: quiet }), /data\/genres\.json にありません/);
  const store = new Store(config.paths.data);
  store.saveGenres(store.genres().map((g) => (g.genre_id === 'ai-ad-creative' ? { ...g, status: 'retired' } : g)));
  await assert.rejects(produce({ config, genreId: 'ai-ad-creative', log: quiet }), /撤退済み/);
  await assert.rejects(produce({ config, log: quiet }), /--genre/);
});

test('scout: 候補を testing で追加し、既存のジャンルは変えない', async () => {
  const { config } = sandbox();
  const r = await scout({ config, count: 2, log: quiet });
  assert.deepEqual(r.added.map((g) => g.genre_id), ['ai-sns-ops', 'ai-small-shop']);
  const genres = new Store(config.paths.data).genres();
  assert.equal(genres.length, 4);
  const added = genres.filter((g) => g.source === 'genreScout');
  assert.ok(added.every((g) => g.status === 'testing' && g.colors?.primary && g.test_started_at));
  assert.notEqual(added[0].colors.primary, added[1].colors.primary);
  assert.equal(added[1].needs_separate_account, true);
  const again = await scout({ config, count: 2, log: quiet });
  assert.deepEqual(again.skipped, ['ai-sns-ops', 'ai-small-shop']);
});

test('analyze: 投稿済みの数字から勝ちパターンを更新し、検証期間が終わったジャンルを判定する', needsBrowser, async () => {
  const { config } = sandbox();
  const store = new Store(config.paths.data);
  store.saveGenres(store.genres().map((g) => (g.genre_id === 'ai-ad-creative' ? { ...g, test_started_at: '2026-01-01' } : g)));
  const r = await produce({ config, genreId: 'ai-note-automation', log: quiet });
  saveStatus(config.paths.output, r.slug, { status: 'posted', note_url: 'https://note.com/demo/n/1', x_urls: ['https://x.com/demo/status/1'], metrics: { note_pv: 300, purchases: 3, x_impressions: 5000, x_profile_clicks: 40 } });
  const result = await analyze({ config, log: quiet });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].noteViews, 300);
  const genres = store.genres();
  assert.equal(genres.find((g) => g.genre_id === 'ai-ad-creative').status, 'retired');
  assert.equal(genres.find((g) => g.genre_id === 'ai-note-automation').status, 'active');
  const patterns = store.patterns();
  assert.ok(patterns.patterns.some((p) => p.dimension === 'article_type'));
  assert.ok(patterns.eyecatch_patterns.length >= 1);
  assert.ok(fs.existsSync(result.reportFile));
});

test('renderer: テンプレートにない図はAIのHTMLで描き、それも無理なら簡易図にする', needsBrowser, async () => {
  const { dir, config } = sandbox();
  const renderer = await Renderer.launch({ templatesDir: config.paths.templates, chromiumPath: config.chromiumPath });
  const ctx = {
    outDir: dir, colors: { primary: '#6657df' }, brand: 'テスト', renderer, warnings: [], log: quiet,
    llm: { run: async (role, vars) => ({ diagrams: [{ id: vars.diagram_specs[0].id, type: 'custom', custom_html: vars.diagram_specs[0].id === '図8' ? '<div style="font:900 80px \'Noto Sans JP\';padding:100px">円グラフの代わり</div><script>document.body.innerHTML="NG"</script><img src="https://example.com/x.png">' : null }] }) },
  };
  try {
    const out = await renderDiagrams(ctx, {
      diagrams: [{ id: '図8', type: 'pie', title: '円グラフ', schema_error: 'テンプレートにない type', items: {} }, { id: '図9', type: 'pie', title: '救済される図', schema_error: 'x', items: { a: ['項目A', '項目B'] } }],
      missing: [], specs: [], body: '本文',
    });
    assert.deepEqual(out.map((o) => [o.id, o.mode]), [['図8', 'custom'], ['図9', 'salvaged']]);
    assert.deepEqual(pngSize(path.join(dir, 'images/08.png')), [1280, 720]);
    assert.deepEqual(pngSize(path.join(dir, 'images/09.png')), [1280, 720]);
    assert.equal(ctx.warnings.length, 2);
  } finally {
    await renderer.close();
  }
});

test('templates: 7種類の図解とアイキャッチ3種を、最大の文字量でも枠に収めて描ける', needsBrowser, async () => {
  const { config } = sandbox();
  const lines = [];
  const files = await renderSamples({ config, log: (l) => lines.push(l) });
  assert.equal(files.length, 11);
  assert.deepEqual(lines.filter((l) => l.includes('はみ出し') || l.includes('違反')), []);
  const types = new Set(files.map((f) => path.basename(f)));
  ['diagram-steps.png', 'diagram-bar_chart.png', 'diagram-matrix.png', 'eyecatch-3-before_after_split.png'].forEach((f) => assert.ok(types.has(f)));
});

test('dashboard API: 一覧・画像ZIP・ファイル・投稿状況の保存', needsBrowser, async () => {
  assert.ok(shared, '最初の produce テストの結果を使います');
  const { config, r } = shared;
  const handler = createApiHandler({ outputDir: config.paths.output });
  const server = http.createServer((req, res) => handler(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/outputs`;
  try {
    const list = await (await fetch(base)).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].state, 'ready');
    assert.equal(list.items[0].x.posts.length, 7);
    const zip = await fetch(`${base}/${r.slug}/images.zip`);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.equal((await fetch(`${base}/${r.slug}/files/${encodeURIComponent('../../../etc/passwd')}`)).status, 404);
    assert.equal((await fetch(`${base}/${r.slug}/files/work/01-ideas.json`)).status, 404);
    assert.equal((await fetch(`${base}/${r.slug}/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' })).status, 403);
    const saved = await (await fetch(`${base}/${r.slug}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'posted', note_url: 'https://note.com/a/n/1' }) })).json();
    assert.equal(saved.state, 'posted');
    assert.equal((await fetch(`${base}/${r.slug}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metrics: { note_pv: -1 } }) })).status, 400);
  } finally {
    server.close();
  }
});
