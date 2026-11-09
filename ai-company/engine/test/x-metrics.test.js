// X の投稿の数字の自動取り込み。X API はすべてスタブ（本物のネットワークは呼ばない＝お金がかからない）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setupEnv } from './helpers.js';

const KEYS = {
  X_MAIN_API_KEY: 'main-consumer-key-123', X_MAIN_API_SECRET: 'MAIN-SECRET-should-never-appear',
  X_MAIN_ACCESS_TOKEN: '111-main-access-token', X_MAIN_ACCESS_TOKEN_SECRET: 'MAIN-TOKEN-SECRET-should-never-appear',
};
const dir = setupEnv({ ...KEYS, USD_JPY_RATE: '150' });
const { getDb, createRecorder } = await import('../db/index.js');
const { oauth1Header, percentEncode } = await import('../integrations/x/oauth1.js');
const { importAccount, loadAccounts, credsFor, headKey, tweetIdFromUrl, fetchDays } = await import('../integrations/x/import.js');
const { runJob } = await import('../runner.js');
const { buildContext } = await import('../context.js');
const { loadSchedule, createScheduler } = await import('../scheduler/scheduler.js');
const { parseCron } = await import('../scheduler/cron.js');
const { localDate, addDays } = await import('../config.js');
const db = getDb();
const rec = createRecorder(db);
rec.ensure_division({ slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note' });
rec.ensure_division({ slug: 'metrics', name: '数字の取り込み' });

// ---- X API のスタブ ----
function stubX({ me = { id: '42', username: 'me_account' }, tweets = [], status = 200, errorBody = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: init.headers.Authorization });
    if (status !== 200) return new Response(JSON.stringify(errorBody || {}), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/2/users/me') return Response.json({ data: me });
    if (u.pathname === `/2/users/${me.id}/tweets`) return Response.json({ data: tweets, meta: { result_count: tweets.length } });
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}
const tweet = (id, text, imp, clicks, createdAt = new Date(Date.now() - 864e5).toISOString()) => ({
  id: String(id), text, created_at: createdAt,
  public_metrics: { impression_count: imp, like_count: 1, retweet_count: 0, reply_count: 0, quote_count: 0 },
  ...(clicks == null ? {} : { non_public_metrics: { impression_count: imp, url_link_clicks: clicks, user_profile_clicks: 0 } }),
});
const MAIN = { envPrefix: 'X_MAIN', divisions: ['x-note'] };

function approvedPost(body, { url = null } = {}) {
  const t = rec.start_task({ division: 'x-note', title: 'x' });
  const file = path.join(dir, 'outputs', `post-${Math.random().toString(36).slice(2)}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const id = rec.save_output({ task_id: t, kind: 'x_post', file_path: file, preview_text: body.slice(0, 160), title: body.slice(0, 10), meta: { hypothesis: '【伸びた型】テスト' } });
  rec.finish_task(t);
  rec.set_approval(id, 'approved');
  if (url) rec.set_published(id, url);
  return id;
}
const postRows = (id) => db.prepare('SELECT date, name, value FROM metrics WHERE output_id = ? ORDER BY name').all(id).map((r) => ({ ...r }));
const resetDaily = () => db.prepare("DELETE FROM app_meta WHERE key LIKE 'x_last_fetch:%'").run();
beforeEach(() => resetDaily());

// ---------- 署名 ----------
test('OAuth 1.0a: X のドキュメントの例と同じ署名になる（node:crypto で自前実装）', () => {
  const h = oauth1Header({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json',
    params: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    creds: { apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
  assert.ok(!h.includes('kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw'), '秘密鍵はヘッダーに入らない');
  assert.ok(!h.includes('LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'));
  assert.equal(percentEncode("a b!*'()"), 'a%20b%21%2A%27%28%29');
});

// ---------- 設定 ----------
test('設定: x-accounts.yaml・キーが1つでも空ならスキップ・X_FETCH_DAYS の既定は3', () => {
  assert.deepEqual(loadAccounts(), [{ envPrefix: 'X_MAIN', divisions: ['x-note'] }, { envPrefix: 'X_SUB', divisions: ['sub-x'] }]);
  assert.ok(credsFor('X_MAIN'));
  assert.equal(credsFor('X_SUB'), null);
  assert.equal(credsFor('X_MAIN', { ...KEYS, X_MAIN_ACCESS_TOKEN_SECRET: '' }), null);
  assert.equal(fetchDays({}), 3);
  assert.equal(fetchDays({ X_FETCH_DAYS: '5' }), 5);
  const ex = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const k of ['X_MAIN_API_KEY=', 'X_MAIN_ACCESS_TOKEN_SECRET=', 'X_SUB_API_KEY=', 'X_SUB_ACCESS_TOKEN_SECRET=']) assert.ok(ex.includes(`\n${k}\n`), k);
  assert.match(ex, /\nX_FETCH_DAYS=3\n/);
  assert.equal(tweetIdFromUrl('https://x.com/me/status/1850000000000000001?s=20'), '1850000000000000001');
  assert.equal(tweetIdFromUrl('https://x.com/example/status/seed-1-0'), null);
  assert.equal(headKey('a  b\nc https://t.co/xyz &amp; d'), 'abc&d');
});

test('キーが空のアカウント・部門が未登録のアカウントは API を呼ばずにスキップ', async () => {
  const { fetchImpl, calls } = stubX();
  const r1 = await importAccount({ rec, account: { envPrefix: 'X_SUB', divisions: ['sub-x'] }, fetchImpl });
  assert.equal(r1.status, 'skipped');
  const r2 = await importAccount({ rec, account: { envPrefix: 'X_MAIN', divisions: ['sub-x'] }, fetchImpl });
  assert.equal(r2.status, 'skipped');
  assert.match(r2.reason, /未登録/);
  assert.equal(calls.length, 0);
});

// ---------- 料金を節約する呼び方 ----------
test('呼び方: /2/users/{id}/tweets だけ・start_time=3日前・max_results=100・tweet.fields は1回で。/2/tweets?ids は使わない', async () => {
  const now = new Date('2026-11-09T21:00:00Z');
  const { fetchImpl, calls } = stubX({ tweets: [] });
  await importAccount({ rec, account: MAIN, fetchImpl, now });
  assert.deepEqual(calls.map((c) => c.path), ['/2/users/me', '/2/users/42/tweets']);
  const q = calls[1].query;
  assert.deepEqual(q, { max_results: '100', start_time: '2026-11-06T21:00:00Z', 'tweet.fields': 'public_metrics,non_public_metrics,created_at' });
  assert.ok(calls.every((c) => !c.path.startsWith('/2/tweets')));
  assert.match(calls[1].auth, /^OAuth .*oauth_consumer_key="main-consumer-key-123".*oauth_signature_method="HMAC-SHA1"/);
  for (const c of calls) assert.ok(!c.auth.includes('should-never-appear'), '秘密鍵を送らない');
});

test('自分のユーザーIDは1回だけ取得して保存。翌日以降は /2/users/me を呼ばない', async () => {
  const { fetchImpl, calls } = stubX({ tweets: [] });
  await importAccount({ rec, account: MAIN, fetchImpl, now: new Date('2026-11-10T21:00:00Z') });
  assert.deepEqual(calls.map((c) => c.path), ['/2/users/42/tweets']);
  assert.equal(JSON.parse(rec.get_meta('x_user:X_MAIN')).id, '42');
  assert.ok(!rec.get_meta('x_user:X_MAIN').includes(KEYS.X_MAIN_ACCESS_TOKEN), 'トークンそのものは保存しない');
});

test('1日1回: 同じ日の2回目は呼ばない（--force のときだけ呼ぶ）', async () => {
  const now = new Date();
  const { fetchImpl, calls } = stubX({ tweets: [] });
  assert.equal((await importAccount({ rec, account: MAIN, fetchImpl, now })).status, 'done');
  const r = await importAccount({ rec, account: MAIN, fetchImpl, now });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /1日1回/);
  assert.equal(calls.length, 1);
  await importAccount({ rec, account: MAIN, fetchImpl, now, force: true });
  assert.equal(calls.length, 2);
});

// ---------- 保存 ----------
test('URL の /status/ID でひも付け、投稿ごとに1行（日付は投稿日）で上書き。clicks が取れなければ空のまま', async () => {
  const a = approvedPost('投稿A 本文です。数字で始める投稿のテスト。※AI生成', { url: 'https://x.com/me_account/status/1001' });
  const b = approvedPost('投稿B 本文です。クリック数が取れない投稿のテスト。※AI生成', { url: 'https://x.com/me_account/status/1002' });
  const day1 = '2026-11-05T01:00:00Z'; // JST 11/5
  let s = stubX({ tweets: [tweet(1001, 'x', 500, 7, day1), tweet(1002, 'y', 300, null, day1)] });
  const r1 = await importAccount({ rec, account: MAIN, fetchImpl: s.fetchImpl });
  assert.equal(r1.updated, 2);
  assert.deepEqual(postRows(a), [{ date: '2026-11-05', name: 'clicks', value: 7 }, { date: '2026-11-05', name: 'impressions', value: 500 }]);
  assert.deepEqual(postRows(b), [{ date: '2026-11-05', name: 'impressions', value: 300 }]);

  // 翌日: 累計が伸びた → 行は増えず値だけ上書き
  resetDaily();
  s = stubX({ tweets: [tweet(1001, 'x', 1200, 9, day1)] });
  await importAccount({ rec, account: MAIN, fetchImpl: s.fetchImpl });
  assert.deepEqual(postRows(a), [{ date: '2026-11-05', name: 'clicks', value: 9 }, { date: '2026-11-05', name: 'impressions', value: 1200 }]);
  // 読む範囲から外れた投稿（B）は最後に取った値のまま
  assert.deepEqual(postRows(b), [{ date: '2026-11-05', name: 'impressions', value: 300 }]);
  // コンテキスト（postStats は SUM）でも二重に数えない
  const ctx = buildContext(db, rec.resolveDivision('x-note'), ['post_reactions']);
  assert.match(ctx, /インプ: 1200 \/ クリック: 9/);
  assert.ok(!/インプ: 1700/.test(ctx));
});

test('URL 未登録の「承認済み・未投稿」は本文の先頭40字で照合し、自動で投稿済みにしてURLを登録・イベントに記録', async () => {
  const body = '例: 議事録の要約で、最初に「決定事項／保留／担当と期限」の3つの見出しを指定すると、手直しが減ります。\n※AI生成';
  const c = approvedPost(body);
  const other = approvedPost('まったく別の下書きです。こちらはひも付かないはず。比較用の本文。※AI生成');
  const postsBefore = db.prepare("SELECT COALESCE(SUM(value),0) s FROM metrics WHERE name = 'posts'").get().s;
  // X 側では改行や & が変わっていても、先頭40字が同じなら一致
  const s = stubX({ tweets: [tweet(2001, body.replace('\n', ' ') + ' https://t.co/abc', 880, 12, '2026-11-08T23:30:00Z'), tweet(2002, '関係ない投稿', 10, 0)] });
  const r = await importAccount({ rec, account: MAIN, fetchImpl: s.fetchImpl });
  assert.equal(r.linked, 1);
  assert.equal(r.unmatched, 1);
  const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(c);
  assert.equal(o.published_url, 'https://x.com/me_account/status/2001');
  assert.equal(JSON.parse(o.meta).published_at, '2026-11-08T23:30:00Z');
  assert.equal(db.prepare('SELECT published_url FROM outputs WHERE id = ?').get(other).published_url, null);
  assert.deepEqual(postRows(c), [{ date: '2026-11-09', name: 'clicks', value: 12 }, { date: '2026-11-09', name: 'impressions', value: 880 }]);
  assert.equal(db.prepare("SELECT COALESCE(SUM(value),0) s FROM metrics WHERE name = 'posts'").get().s, postsBefore + 1);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE message LIKE 'X の投稿と自動でひも付けて投稿済みにしました%'").get().c === 1);
});

test('先頭40字が一致する下書きが複数あるときは自動でひも付けない', async () => {
  const body = '同じ書き出しの下書きが2つある場合のテストです。どちらか分からないので登録しない。';
  const x1 = approvedPost(body + 'A');
  const x2 = approvedPost(body + 'B');
  const s = stubX({ tweets: [tweet(3001, body + 'C', 50, 1)] });
  const r = await importAccount({ rec, account: MAIN, fetchImpl: s.fetchImpl });
  assert.equal(r.ambiguous, 1);
  for (const id of [x1, x2]) assert.equal(db.prepare('SELECT published_url FROM outputs WHERE id = ?').get(id).published_url, null);
});

test('推定費用: 読んだ件数 × $0.001 をイベントに記録し、APIコストにも入れる', async () => {
  const today = localDate();
  const before = db.prepare("SELECT COALESCE(SUM(value),0) s FROM metrics WHERE name = 'api_cost_jpy' AND date = ?").get(today).s;
  const s = stubX({ tweets: Array.from({ length: 7 }, (_, i) => tweet(4000 + i, `t${i}`, 1, 0)) });
  const r = await importAccount({ rec, account: { ...MAIN, costDivision: rec.resolveDivision('metrics').id }, fetchImpl: s.fetchImpl });
  assert.equal(r.read, 7);
  assert.equal(r.costUsd, 0.007);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE message LIKE '%投稿 7件を読みました。推定費用 $0.007（7件 × $0.001）%'").get().c === 1);
  const after = db.prepare("SELECT COALESCE(SUM(value),0) s FROM metrics WHERE name = 'api_cost_jpy' AND date = ?").get(today).s;
  assert.equal(Math.round((after - before) * 100) / 100, 1.05); // 0.007 × 150
});

// ---------- ジョブとして動かす（npm run metrics:x と同じ経路） ----------
async function runMetricsJob(stub) {
  resetDaily();
  return runJob('metrics', 'x', { rec, options: { fetchImpl: stub.fetchImpl } });
}
const lastFail = () => db.prepare("SELECT message FROM events WHERE type = 'fail' ORDER BY id DESC LIMIT 1").get()?.message || '';

test('402 CreditsDepleted: わかりやすい日本語で fail を残し、リトライしない', async () => {
  const r = await runMetricsJob(stubX({ status: 402, errorBody: { title: 'CreditsDepleted', detail: 'Your account has no credits', type: 'https://api.x.com/2/problems/credits' } }));
  assert.equal(r.status, 'failed');
  assert.equal(r.retryable, false);
  assert.match(lastFail(), /クレジットが切れています（402 CreditsDepleted）/);
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(r.taskId).status, 'failed');
  assert.equal(rec.get_meta('x_last_fetch:X_MAIN'), null, '失敗した日は取り込み済みにしない');
});

test('401 / 403: キーの間違いとして日本語で fail。キーの値はイベントにもエラーにも出さない', async () => {
  for (const status of [401, 403]) {
    db.prepare("DELETE FROM app_meta WHERE key = 'x_user:X_MAIN'").run();
    const r = await runMetricsJob(stubX({ status, errorBody: { title: status === 401 ? 'Unauthorized' : 'Forbidden' } }));
    assert.equal(r.status, 'failed');
    assert.equal(r.retryable, false);
    assert.match(lastFail(), /キー/);
    assert.match(lastFail(), /X_MAIN_API_KEY/);
  }
  const all = JSON.stringify(db.prepare('SELECT message FROM events').all()) + JSON.stringify(db.prepare('SELECT error FROM tasks').all()) + JSON.stringify(db.prepare('SELECT * FROM app_meta').all());
  for (const v of Object.values(KEYS)) assert.ok(!all.includes(v), `キーの値が記録されている: ${v.slice(0, 4)}…`);
});

test('ジョブ成功: 事業部ビューで「数字の取り込み」として記録され、売上の入力先や比較には出ない', async () => {
  const r = await runMetricsJob(stubX({ tweets: [] }));
  assert.equal(r.status, 'done');
  const { divisionsOverview, dashboard } = await import('../db/queries.js');
  assert.ok(divisionsOverview(db).some((d) => d.slug === 'metrics' && d.lamp === 'idle'));
  const dash = dashboard(db, { days: 7 });
  assert.ok(!dash.input_divisions.some((d) => d.slug === 'metrics'));
  assert.ok(!dash.goals.some((d) => d.slug === 'metrics'));
});

test('schedule.yaml: 毎朝 6:00 の metrics:x（7時の生成より前）', () => {
  const s = loadSchedule();
  const m = s.jobs.find((j) => j.key === 'metrics:x');
  assert.equal(m.cron, '0 6 * * *');
  const xd = s.jobs.find((j) => j.key === 'x-note:daily');
  assert.equal(xd.cron, '0 7 * * *');
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['metrics:x'], /run\.js metrics x/);
});

test('取り込みが失敗しても毎日の生成ジョブは動く（終了コード4はリトライしない）', async () => {
  const started = [];
  const spawnJob = (job) => {
    const child = new EventEmitter();
    child.kill = () => {};
    started.push(job.key);
    setTimeout(() => child.emit('exit', job.division === 'metrics' ? 4 : 0), 20);
    return child;
  };
  const sch = createScheduler({ schedule: { retry: 1, retryDelayMs: 10, jobs: [] }, rec, spawnJob });
  const j = (division, job) => ({ division, job, key: `${division}:${job}`, parsed: parseCron('0 6 * * *') });
  sch.launch(j('metrics', 'x'));
  sch.launch(j('x-note', 'daily'));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(started.sort(), ['metrics:x', 'x-note:daily'], 'metrics:x は1回だけ（リトライなし）、生成は動く');
  assert.match(lastFail(), /metrics:x が失敗しました/);
});

test('投稿のAPIは作らない（クライアントは読み取りの2つだけ）', async () => {
  const src = fs.readFileSync(new URL('../integrations/x/client.js', import.meta.url), 'utf8');
  assert.ok(!/method:\s*'POST'/.test(src));
  assert.ok(!/\/2\/tweets['"`?]/.test(src.replace(/GET \/2\/tweets\?ids=\.\.\. は通常料金/, '')));
});
