// サブアカウントの部門（例: sub-x）を new-division で登録すると、口調・実体験は knowledge/accounts/sub/ を読み、
// X 投稿なら仮説のルールが入り、X_SUB のキーで数字を取り込めるようになる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv } from './helpers.js';

const dir = setupEnv({ X_SUB_API_KEY: 'k', X_SUB_API_SECRET: 's', X_SUB_ACCESS_TOKEN: 't', X_SUB_ACCESS_TOKEN_SECRET: 'ts' });
const root = path.join(dir, 'root');
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
for (const p of ['engine/templates', 'engine/divisions/x-note', 'engine/scheduler/schedule.yaml', 'engine/integrations/x-accounts.yaml', 'knowledge']) {
  fs.cpSync(path.join(src, p), path.join(root, p), { recursive: true });
}
fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
process.env.AI_COMPANY_ROOT = root;

const { normalizeSpec, createDivision, knowledgePaths } = await import('../cli/new-division.js');
const { getDb, createRecorder } = await import('../db/index.js');
const { loadAccounts, importAccount } = await import('../integrations/x/import.js');
const rec = createRecorder(getDb());

const SPEC = {
  slug: 'sub-x', 名前: 'サブX事業部', やること: 'サブアカウントでX投稿案を作る', アカウント: 'sub',
  成果物: { 種類: 'x_post', 数: 3, 形式: '140〜280字の投稿' }, 頻度: '0 7 * * *', 禁止事項: ['メインアカウントの文面を使い回さない'],
};

test('knowledge/accounts/sub/ のひな形がある', () => {
  for (const f of ['voice.md', 'experience.md', 'themes.md']) assert.ok(fs.existsSync(path.join(src, 'knowledge/accounts/sub', f)), f);
  assert.deepEqual(knowledgePaths('sub'), { voice_path: 'knowledge/accounts/sub/voice.md', experience_path: 'knowledge/accounts/sub/experience.md', themes_path: 'knowledge/accounts/sub/themes.md' });
  assert.equal(knowledgePaths(null).voice_path, 'knowledge/my-voice.md');
  assert.ok(normalizeSpec({ ...SPEC, アカウント: 'Sub X' }).errors.some((e) => e.includes('アカウント')));
});

test('sub-x を登録: SKILL.md は sub の voice / experience を参照し、仮説のルールが入る', () => {
  const { spec, errors } = normalizeSpec(SPEC);
  assert.deepEqual(errors, []);
  const r = createDivision(spec, { rec });
  assert.deepEqual(r.missingKnowledge, []);
  const skill = fs.readFileSync(path.join(root, '.claude/skills/sub-x/SKILL.md'), 'utf8');
  assert.match(skill, /knowledge\/accounts\/sub\/voice\.md/);
  assert.match(skill, /knowledge\/accounts\/sub\/experience\.md/);
  assert.match(skill, /knowledge\/accounts\/sub\/themes\.md/);
  assert.ok(!skill.includes('knowledge/my-voice.md') && !skill.includes('knowledge/my-experience.md'));
  assert.match(skill, /3本のうち2本は直近で伸びた型、1本は新しい仮説を試す。各投稿の meta.hypothesis に何を試したかを1行で書く/);
});

test('登録後は X_SUB のキーで sub-x の数字を取り込める', async () => {
  const sub = loadAccounts().find((a) => a.envPrefix === 'X_SUB');
  assert.deepEqual(sub.divisions, ['sub-x']);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url).pathname);
    return url.includes('/users/me') ? Response.json({ data: { id: '77', username: 'sub_account' } }) : Response.json({ data: [], meta: { result_count: 0 } });
  };
  const r = await importAccount({ rec, account: sub, fetchImpl });
  assert.equal(r.status, 'done');
  assert.deepEqual(calls, ['/2/users/me', '/2/users/77/tweets']);
});
