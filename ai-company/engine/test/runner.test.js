import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, claudeCalls } from './helpers.js';

const dir = setupEnv();
const { getDb, createRecorder } = await import('../db/index.js');
const { runJob } = await import('../runner.js');
const { checkOutput } = await import('../compliance.js');
const { extractJson } = await import('../claude.js');
const { acquireLock } = await import('../lock.js');
const { config } = await import('../config.js');
const db = getDb();
const rec = createRecorder(db);
const events = (taskId) => db.prepare('SELECT type, message FROM events WHERE task_id = ? ORDER BY id').all(taskId);

test('x-note daily: claude -p で Skill を呼び、承認待ちが3件並ぶ', async () => {
  const r = await runJob('x-note', 'daily', { rec });
  assert.equal(r.status, 'done');
  assert.equal(r.taskStatus, 'awaiting_approval');
  const outs = db.prepare("SELECT * FROM outputs WHERE task_id = ? AND approval = 'pending'").all(r.taskId);
  assert.equal(outs.length, 3);
  for (const o of outs) {
    assert.equal(o.kind, 'x_post');
    const abs = path.resolve(config.root, o.file_path);
    assert.ok(abs.startsWith(path.join(dir, 'outputs')), o.file_path);
    assert.match(fs.readFileSync(abs, 'utf8'), /※AI生成/);
  }
  const types = events(r.taskId).map((e) => e.type);
  assert.equal(types[0], 'start');
  assert.equal(types.at(-1), 'finish');
  // 読み取り専用ツールだけ許可されている
  const call = claudeCalls().at(-1);
  assert.ok(call.argv.includes('--disallowedTools'));
  assert.ok(call.argv.slice(call.argv.indexOf('--disallowedTools')).includes('Bash'));
  assert.match(call.prompt, /「x-note」Skill/);
  assert.match(call.prompt, /直近14日に使ったテーマ/);
  // APIコスト $0.05 × 150
  assert.equal(db.prepare("SELECT value FROM metrics WHERE name='api_cost_jpy'").get().value, 7.5);
});

test('weekly-note: note 記事1本', async () => {
  const r = await runJob('x-note', 'weekly-note', { rec });
  assert.equal(r.status, 'done');
  const o = db.prepare('SELECT * FROM outputs WHERE task_id = ?').all(r.taskId);
  assert.equal(o.length, 1);
  assert.equal(o[0].kind, 'note_article');
});

test('claude が失敗すると fail_task（赤）になり、エラーが残る', async () => {
  process.env.FAKE_CLAUDE_MODE = 'fail';
  try {
    const r = await runJob('x-note', 'daily', { rec });
    assert.equal(r.status, 'failed');
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.taskId);
    assert.equal(t.status, 'failed');
    assert.match(t.error, /overloaded/);
    assert.ok(events(r.taskId).some((e) => e.type === 'fail'));
  } finally { delete process.env.FAKE_CLAUDE_MODE; }
});

test('JSON がない返答は失敗扱い', async () => {
  process.env.FAKE_CLAUDE_MODE = 'badjson';
  try {
    const r = await runJob('x-note', 'daily', { rec });
    assert.equal(r.status, 'failed');
    assert.match(r.reason, /JSON/);
  } finally { delete process.env.FAKE_CLAUDE_MODE; }
});

test('修正コメント → 次の実行で修正版が承認待ちに出る', async () => {
  const o = db.prepare("SELECT id FROM outputs WHERE approval = 'pending' AND kind = 'x_post' LIMIT 1").get();
  const q = rec.request_revision(o.id, 'もっと短く');
  const r = await runJob('x-note', 'revise', { rec });
  assert.equal(r.status, 'done');
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(q).status, 'awaiting_approval');
  const revised = db.prepare('SELECT * FROM outputs WHERE task_id = ?').all(q);
  assert.equal(revised.length, 1);
  assert.match(claudeCalls().at(-1).prompt, /もっと短く/);
});

test('一時停止中はスキップ、--force なら実行', async () => {
  rec.set_division_status('x-note', 'paused');
  assert.equal((await runJob('x-note', 'daily', { rec })).reason, 'paused');
  assert.equal((await runJob('x-note', 'daily', { rec, force: true })).status, 'done');
  rec.set_division_status('x-note', 'active');
});

test('同じ事業部の二重起動を防ぐ', async () => {
  const release = acquireLock('x-note');
  try {
    const r = await runJob('x-note', 'daily', { rec });
    assert.equal(r.reason, 'locked');
  } finally { release(); }
});

test('コンプライアンスチェック', () => {
  const a = checkOutput('x_post', '誰でも月50万稼げる方法');
  assert.ok(a.warnings.some((w) => w.includes('誇大')));
  assert.ok(a.body.endsWith('※AI生成'));
  assert.ok(a.warnings.some((w) => w.includes('文字数')));
  const b = checkOutput('x_post', 'おすすめ https://amzn.to/abc ※AI生成');
  assert.ok(b.warnings.some((w) => w.includes('ステマ')));
  const c = checkOutput('x_post', '【PR】おすすめ https://amzn.to/abc ※AI生成');
  assert.ok(!c.warnings.some((w) => w.includes('ステマ')));
  const d = checkOutput('note_article', '# t\n本文');
  assert.ok(d.warnings.some((w) => w.includes('無料部分')));
  assert.deepEqual(extractJson('前置き\n```json\n{"a":1}\n```\n後ろ'), { a: 1 });
  assert.throws(() => extractJson('no json'));
});
