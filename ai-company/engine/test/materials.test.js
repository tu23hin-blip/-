// 材料づくり: 口調の自動作成・実績の候補抽出・テーマのリサーチ。X API と claude はスタブ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, claudeCalls } from './helpers.js';

const KEYS = { X_MAIN_API_KEY: 'k', X_MAIN_API_SECRET: 'MAIN-SECRET-xyz', X_MAIN_ACCESS_TOKEN: '1-tok', X_MAIN_ACCESS_TOKEN_SECRET: 'MAIN-TS-xyz' };
const dir = setupEnv({ ...KEYS, USD_JPY_RATE: '150', RESEARCH_MAX_READS: '' });
const kb = path.join(dir, 'knowledge');
fs.cpSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../knowledge'), kb, { recursive: true });
for (const f of fs.readdirSync(path.join(kb, 'reports'))) if (f.endsWith('.md')) fs.rmSync(path.join(kb, 'reports', f));
process.env.KNOWLEDGE_DIR = kb;

const { getDb, createRecorder } = await import('../db/index.js');
const { runJob } = await import('../runner.js');
const { createXClient } = await import('../integrations/x/client.js');
const { voiceStats, verifyCandidates, topByImpressions } = await import('../integrations/x/voice.js');
const { planReads, score, shingles, copiesFrom, maxReads } = await import('../integrations/x/research.js');
const { mergeResearchSection, appendExperience, RESEARCH_START, EXPERIENCE_HEADING, loadResearchConfig, knowledgePathsFor } = await import('../knowledge.js');
const { loadSchedule } = await import('../scheduler/scheduler.js');
const { parseLimit, config, localDate } = await import('../config.js');
const db = getDb();
const rec = createRecorder(db);
rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note' });
rec.ensure_division({ slug: 'materials', name: '材料づくり' });
const read = (rel) => fs.readFileSync(path.join(kb, rel), 'utf8');

// ---- X API スタブ ----
function ownTweets(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(9000 + i), created_at: '2026-10-01T00:00:00Z',
    text: i === 0 ? '議事録の手直しが3割減りました。見出しを先に決めただけです。\n※AI生成' : `投稿${i}です。今日も小さく改善しました${i % 3 === 0 ? '😊' : ''}。\n2行目です`,
    public_metrics: { impression_count: i === 7 ? 99999 : 100 + i, like_count: 1, retweet_count: 0, quote_count: 0 },
  }));
}
function othersTweets(keyword, n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${keyword.length}${i}${Math.random().toString().slice(2, 8)}`, lang: 'ja', created_at: '2026-11-08T00:00:00Z',
    text: `他人の投稿「${keyword}」で独自の言い回しをしているぶんしょうです番号${i}`,
    public_metrics: { like_count: i, retweet_count: i % 5, quote_count: 0, impression_count: i * 100 },
  }));
}
function stubX({ own = ownTweets(250), searchAvailable = 100, status = 200, errorBody = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, query: q });
    if (status !== 200) return new Response(JSON.stringify(errorBody), { status });
    if (u.pathname === '/2/users/me') return Response.json({ data: { id: '42', username: 'me' } });
    if (u.pathname === '/2/users/42/tweets') {
      const start = q.pagination_token ? Number(q.pagination_token) : 0;
      const page = own.slice(start, start + Number(q.max_results));
      const next = start + page.length < own.length ? String(start + page.length) : undefined;
      return Response.json({ data: page, meta: { result_count: page.length, ...(next ? { next_token: next } : {}) } });
    }
    if (u.pathname === '/2/tweets/search/recent') {
      const kw = q.query.split(' lang:')[0];
      return Response.json({ data: othersTweets(kw, Math.min(Number(q.max_results), searchAvailable)) });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}
const run = (job, stub, extra = {}) => runJob('materials', job, { rec, force: extra.force, options: { args: ['x-note'], fetchImpl: stub.fetchImpl, force: extra.force } });
const pending = (type) => db.prepare("SELECT * FROM outputs WHERE approval = 'pending' AND json_extract(meta,'$.type') = ?").all(type).map((o) => ({ ...o, meta: JSON.parse(o.meta) }));
// テストで何度も動かすと1日の上限（200円）に届くので、各テストの前に今日のコストと停止状態を戻す
function resetBudget() {
  db.prepare("DELETE FROM metrics WHERE name = 'api_cost_jpy'").run();
  db.prepare("UPDATE divisions SET status = 'active'").run();
}
const events = (taskId) => db.prepare('SELECT type, message FROM events WHERE task_id = ? ORDER BY id').all(taskId).map((e) => e.message);

// ---------- 設定 ----------
test('設定: 上限の既定は200円・research.yaml・スケジュール（月木6:30・メインだけ）・short-video は一時停止で登録', () => {
  assert.equal(parseLimit(''), 200);
  assert.equal(parseLimit(undefined), 200);
  assert.equal(parseLimit('none'), null);
  assert.equal(parseLimit('500'), 500);
  assert.equal(config.dailyCostLimitJpy, 200);
  assert.match(fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'), /\nDAILY_API_COST_LIMIT_JPY=200\n[\s\S]*\nRESEARCH_MAX_READS=150\n/);
  assert.equal(maxReads({}), 150);
  const rc = loadResearchConfig(knowledgePathsFor('x-note').research);
  assert.ok(rc.keywords.length >= 1 && rc.keywords.length <= 5);
  assert.equal(rc.lang, 'ja');
  const jobs = loadSchedule().jobs.filter((j) => j.division === 'materials');
  assert.deepEqual(jobs.map((j) => [j.key, j.cron, j.args]), [['materials:research:x-note', '30 6 * * 1,4', ['x-note']]]);
  assert.ok(loadSchedule().jobs.some((j) => j.key === 'short-video:main'), 'short-video の予定は残す');
  const sv = fs.readFileSync(new URL('../divisions/short-video/division.yaml', import.meta.url), 'utf8');
  assert.match(sv, /initial_status: paused/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['voice:build'], /run\.js materials voice$/);
  assert.match(pkg.scripts['research:x'], /run\.js materials research$/);
});

// ---------- 口調 ----------
test('過去の投稿は Owned Reads で最大200件（リポスト・返信を除く、100件ずつ）', async () => {
  const { fetchImpl, calls } = stubX({ own: ownTweets(250) });
  const c = createXClient({ apiKey: 'k', apiSecret: 's', accessToken: 't', accessTokenSecret: 'ts' }, { fetchImpl });
  const got = await c.getOwnHistory('42', { limit: 200 });
  assert.equal(got.length, 200);
  assert.deepEqual(calls.map((x) => [x.path, x.query.max_results, x.query.exclude, x.query.pagination_token]),
    [['/2/users/42/tweets', '100', 'retweets,replies', undefined], ['/2/users/42/tweets', '100', 'retweets,replies', '100']]);
  assert.equal((await createXClient({ apiKey: 'k', apiSecret: 's', accessToken: 't', accessTokenSecret: 'ts' }, { fetchImpl: stubX({ own: ownTweets(30) }).fetchImpl }).getOwnHistory('42')).length, 30);
});

test('口調の特徴はプログラムで数え、AIの実績候補は元の投稿に根拠があるものだけ残す', () => {
  const t = ownTweets(9);
  const s = voiceStats(t);
  assert.equal(s.posts, 9);
  assert.equal(s.emoji_posts_pct, 22); // 2/9（i=3,6。g フラグのずれがないこと）
  assert.ok(s.avg_line_breaks >= 1);
  assert.equal(topByImpressions(t, 1)[0].id, '9007');
  const byId = new Map(t.map((x) => [x.id, x]));
  const { kept, dropped } = verifyCandidates([
    { text: '議事録の手直しが3割減った', source_id: '9000', quote: '議事録の手直しが3割減りました' },
    { text: '月収100万', source_id: '9000', quote: '月収100万円を達成' },
    { text: '存在しない投稿', source_id: '1', quote: '議事録の手直しが3割' },
  ], byId);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 2);
});

test('voice:build: 口調の下書きと実績の候補を承認待ちに出す（承認するまでファイルは変わらない）', async () => {
  const voiceBefore = read('my-voice.md');
  const expBefore = read('my-experience.md');
  const stub = stubX({ own: ownTweets(250) });
  const r = await run('voice', stub);
  assert.equal(r.status, 'done');
  assert.equal(r.result.read, 200);
  assert.equal(r.result.costUsd, 0.2);
  // Owned Reads だけ（検索・ids は呼ばない）
  assert.ok(stub.calls.every((c) => ['/2/users/me', '/2/users/42/tweets'].includes(c.path)));
  const msgs = events(r.taskId).join('\n');
  assert.match(msgs, /自分の投稿 200件を読みました。推定費用 \$0\.200（200件 × \$0\.001・Owned Reads）/);
  assert.match(msgs, /根拠の文言が見つからないため捨てました/);
  // claude に渡したお手本はインプレッション上位20件（最上位が先頭）
  const prompt = claudeCalls().at(-1).prompt;
  assert.match(prompt, /^ジョブ: voice/);
  assert.match(prompt.split('## お手本')[1], /^[^\n]*\n- \[id:9007\]/);
  assert.equal((prompt.split('## お手本')[1].split('## 全投稿')[0].match(/\[id:/g) || []).length, 20);

  const [voice] = pending('voice_update');
  assert.equal(voice.meta.target_path, 'knowledge/my-voice.md');
  const cands = pending('experience_candidate');
  assert.equal(cands.length, 1, '投稿にない数字の候補は出さない');
  assert.equal(read('my-voice.md'), voiceBefore, '承認前は上書きしない');
  assert.equal(read('my-experience.md'), expBefore, '承認前は追記しない');
  assert.throws(() => rec.request_revision(voice.id, '直して'), /承認」か「却下」だけ/);

  rec.set_approval(voice.id, 'approved');
  const v = read('my-voice.md');
  assert.match(v, /## 基本/);
  assert.match(v, /## お手本（インプレッション上位20件・自分の投稿）/);
  assert.match(v, /文末に「※AI生成」/);
  assert.ok(fs.readdirSync(path.join(dir, 'outputs', 'knowledge-backups')).some((f) => f.startsWith('my-voice-')));

  rec.set_approval(cands[0].id, 'approved');
  const e = read('my-experience.md');
  assert.ok(e.startsWith(expBefore.trimEnd()), '既存の内容は残す');
  assert.match(e, new RegExp(`${EXPERIENCE_HEADING}\\n\\n- 投稿で紹介した実績: `));
  assert.match(e, /https:\/\/x\.com\/me\/status\/9000/);
  assert.ok(!e.includes('月収100万'));
});

test('voice:build は初回だけ（2回目はスキップ。--force でやり直し）', async () => {
  const stub = stubX();
  const r = await run('voice', stub);
  assert.equal(r.result.status, 'skipped');
  assert.equal(stub.calls.length, 0, 'APIを呼ばない');
  const r2 = await run('voice', stubX(), { force: true });
  assert.equal(r2.result.status, 'done');
});

test('appendExperience: 見出しの下に追記し、同じ行は二重に足さない', () => {
  const a = appendExperience('# 実績\n\n## 経歴\n- x\n', 'A');
  const b = appendExperience(a, 'B');
  assert.equal(appendExperience(b, 'B'), b);
  assert.match(b, new RegExp(`${EXPERIENCE_HEADING}\\n\\n- A\\n- B\\n$`));
  const c = appendExperience(`# 実績\n\n${EXPERIENCE_HEADING}\n\n- A\n\n## その他\n- z\n`, 'B');
  assert.match(c, /- A\n- B\n\n## その他/);
});

// ---------- リサーチ ----------
test('読む件数の割り振り: 合計が上限を超えない（max_results は10〜100）', () => {
  const kw = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(planReads(kw, 150).map((p) => p.maxResults), [30, 30, 30, 30, 30]);
  assert.deepEqual(planReads(kw, 34).map((p) => p.maxResults), [11, 11, 11]);
  assert.deepEqual(planReads(kw, 9), []);
  assert.deepEqual(planReads(['a'], 500).map((p) => p.maxResults), [100]);
  for (const n of [10, 25, 49, 150, 151, 999]) assert.ok(planReads(kw, n).reduce((s, p) => s + p.maxResults, 0) <= n);
  assert.equal(score({ public_metrics: { like_count: 10, retweet_count: 2, quote_count: 1, impression_count: 500 } }), 20);
  const set = shingles(['これは他人の独自の言い回しです']);
  assert.ok(copiesFrom('やはり他人の独自の言い回しですね', set));
  assert.equal(copiesFrom('自分の言葉で書いた説明', set), null);
});

test('research:x: 上限150件まで検索し、書き写したテーマは捨て、themes.md の更新案を承認待ちに出す', async () => {
  const themesBefore = read('themes.md');
  const stub = stubX();
  const r = await run('research', stub);
  assert.equal(r.status, 'done');
  assert.equal(r.result.read, 150);
  assert.equal(r.result.costUsd, 0.75);
  const searches = stub.calls.filter((c) => c.path === '/2/tweets/search/recent');
  assert.equal(searches.length, 5);
  for (const c of searches) {
    assert.match(c.query.query, / lang:ja -is:retweet$/);
    assert.equal(c.query.max_results, '30');
  }
  assert.ok(stub.calls.every((c) => c.path === '/2/tweets/search/recent'), '検索以外は呼ばない');
  const msgs = events(r.taskId).join('\n');
  assert.match(msgs, /150件を読みました（上限 150件）。推定費用 \$0\.750（150件 × \$0\.005）/);
  assert.match(msgs, /言い回しと一致する部分があったテーマ 1件を捨てました/);
  assert.equal(r.result.themes, 6);

  const [p] = pending('themes_update');
  assert.equal(p.meta.target_path, 'knowledge/themes.md');
  assert.equal(read('themes.md'), themesBefore, '承認前は変えない');
  const section = fs.readFileSync(path.resolve(config.root, p.file_path), 'utf8');
  assert.ok(!section.includes('コピーしたテーマ'));
  assert.ok(!/他人の投稿/.test(section.replace('他人の投稿の文章・言い回しは書き写さない', '')), '他人の文章を書き写さない');
  // 他人の投稿の文章は、イベント・成果物のどこにも残さない
  const everything = JSON.stringify(db.prepare('SELECT message FROM events').all()) + JSON.stringify(db.prepare('SELECT preview_text, title FROM outputs').all()) + section;
  assert.ok(!everything.includes('独自の言い回しをしているぶんしょう'));

  rec.set_approval(p.id, 'approved');
  const after = read('themes.md');
  assert.ok(after.startsWith(themesBefore.trimEnd()), '3本柱などの既存の内容は残す');
  assert.match(after, /## 今伸びているテーマ（Xリサーチ .*・承認済み）/);
  assert.match(after, /### 1\. テーマ1\n- なぜ伸びているか: 理由1/);

  // 次回の承認は前回のセクションを置き換える（重ならない）
  resetBudget();
  const r2 = await run('research', stubX());
  rec.set_approval(pending('themes_update')[0].id, 'approved');
  assert.equal(read('themes.md').split(RESEARCH_START).length, 2);
  assert.ok(r2.result.read <= 150);
});

test('RESEARCH_MAX_READS を超えて読まない／今日のAPIコストの残りに合わせて減らす', async () => {
  resetBudget();
  process.env.RESEARCH_MAX_READS = '25';
  try {
    const stub = stubX();
    const r = await run('research', stub);
    assert.equal(r.status, 'done', JSON.stringify(r));
    assert.equal(r.result.read, 24);
    assert.deepEqual(stub.calls.map((c) => c.query.max_results), ['12', '12']);
  } finally { process.env.RESEARCH_MAX_READS = ''; }
  // 上限 200円のうち 190円使用済み → 残り 10円 ÷ 0.75円 = 13件まで
  resetBudget();
  rec.add_metric({ date: localDate(), division: 'materials', name: 'api_cost_jpy', value: 190 });
  const stub = stubX();
  db.prepare("UPDATE divisions SET status = 'active'").run();
  const r = await run('research', stub);
  assert.equal(r.status, 'done', JSON.stringify(r));
  assert.ok(r.result.read <= 13, `read=${r.result.read}`);
  assert.deepEqual(stub.calls.map((c) => c.query.max_results), ['13']);
  assert.match(events(r.taskId).join('\n'), /読む件数を 150件 → 13件に減らします/);
  resetBudget();
});

test('research.yaml のキーワードが6個以上ならエラー（APIは呼ばない）', async () => {
  resetBudget();
  const f = path.join(kb, 'research.yaml');
  const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, 'keywords: [a, b, c, d, e, f]\nlang: ja\n');
  try {
    const stub = stubX();
    const r = await run('research', stub);
    assert.equal(r.status, 'failed');
    assert.equal(r.retryable, false);
    assert.match(r.reason, /5個まで/);
    assert.equal(stub.calls.length, 0);
  } finally { fs.writeFileSync(f, orig); }
});

test('402 のときは日本語で失敗を残し、リトライしない。キーの値は残さない', async () => {
  resetBudget();
  const r = await run('research', stubX({ status: 402, errorBody: { title: 'CreditsDepleted' } }));
  assert.equal(r.status, 'failed');
  assert.equal(r.retryable, false);
  assert.match(r.reason, /クレジットが切れています/);
  const all = JSON.stringify(db.prepare('SELECT message FROM events').all()) + JSON.stringify(db.prepare('SELECT error FROM tasks').all());
  for (const v of [KEYS.X_MAIN_API_SECRET, KEYS.X_MAIN_ACCESS_TOKEN_SECRET, KEYS.X_MAIN_ACCESS_TOKEN]) assert.ok(!all.includes(v), v);
});

test('Skill: 他人の投稿を書き写さない禁止事項と、今伸びているテーマを優先する指示', () => {
  const skill = fs.readFileSync(new URL('../../.claude/skills/x-note/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /他人の投稿の文章・言い回しを書き写すこと/);
  assert.match(skill, /今伸びているテーマ/);
  const tpl = fs.readFileSync(new URL('../templates/SKILL.template.md', import.meta.url), 'utf8');
  assert.match(tpl, /他人の投稿の文章・言い回しを書き写さない/);
  assert.equal(mergeResearchSection('# t\n', `${RESEARCH_START}\nA\n<!-- research:end -->\n`), `# t\n\n${RESEARCH_START}\nA\n<!-- research:end -->\n`);
});
