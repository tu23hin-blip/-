import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setupEnv } from './helpers.js';

const dir = setupEnv();
// 本物の .claude/skills と engine/divisions を汚さないよう、一時フォルダに丸ごとコピーして AI_COMPANY_ROOT を向ける
const root = path.join(dir, 'root');
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
for (const p of ['engine/templates', 'engine/divisions/x-note', 'engine/scheduler/schedule.yaml', 'specs/short-video.yaml', 'knowledge']) {
  fs.cpSync(path.join(src, p), path.join(root, p), { recursive: true });
}
fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
process.env.AI_COMPANY_ROOT = root;

const { normalizeSpec, createDivision } = await import('../cli/new-division.js');
const { getDb, createRecorder } = await import('../db/index.js');
const { runJob } = await import('../runner.js');
const { divisionsOverview } = await import('../db/queries.js');
const { checkOutput } = await import('../compliance.js');
const rec = createRecorder(getDb());

test('仕様書の検証', () => {
  const { errors } = normalizeSpec({ slug: 'Bad Slug', 名前: '', 成果物: { 種類: 'tweet' }, 頻度: 'every day' });
  assert.ok(errors.length >= 5);
});

test('ショート動画事業部を仕様書から追加 → 実行 → 事業部ビューに出る', async () => {
  const raw = YAML.parse(fs.readFileSync(path.join(root, 'specs/short-video.yaml'), 'utf8'));
  const { spec, errors } = normalizeSpec(raw);
  assert.deepEqual(errors, []);
  createDivision(spec, { rec });
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/short-video/SKILL.md')));
  const skill = fs.readFileSync(path.join(root, '.claude/skills/short-video/SKILL.md'), 'utf8');
  assert.match(skill, /実在人物の顔/);
  assert.match(skill, /name: short-video/);
  const sched = YAML.parse(fs.readFileSync(path.join(root, 'engine/scheduler/schedule.yaml'), 'utf8'));
  assert.ok(sched.jobs.some((j) => j.division === 'short-video' && j.cron === '0 9 * * *'));
  assert.throws(() => createDivision(spec, { rec }), /すでにあります/);

  const r = await runJob('short-video', 'main', { rec });
  assert.equal(r.status, 'done');
  const card = divisionsOverview(rec.db).find((d) => d.slug === 'short-video');
  assert.equal(card.name, 'ショート動画事業部');
  assert.equal(card.pending, 1);
  assert.equal(card.lamp, 'awaiting');
});

test('尺チェック', () => {
  assert.ok(checkOutput('script', '[0-3秒] a\n[50-75秒] b ※AIを活用して制作', { max_seconds: 60 }).warnings.some((w) => w.includes('60秒')));
  assert.ok(!checkOutput('script', '[0-3秒] a\n[45-58秒] b ※AIを活用して制作', { max_seconds: 60 }).warnings.length);
});
