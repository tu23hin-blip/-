// 新しい事業部を仕様書（YAML）から作る。
//   npm run new-division -- init <slug>             … specs/<slug>.yaml をひな形から作る
//   npm run new-division -- specs/<slug>.yaml       … 事業部を作る
//   npm run new-division -- specs/<slug>.yaml --force  … 既存の Skill / 設定を上書き
//   npm run new-division -- specs/<slug>.yaml --account sub … 口調・実体験・テーマを knowledge/accounts/sub/ から読む
// 作るもの:
//   .claude/skills/<slug>/SKILL.md
//   engine/divisions/<slug>/division.yaml（＋ spec.yaml の写し）
//   engine/scheduler/schedule.yaml への追記
//   DB の divisions への登録
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { config } from '../config.js';
import { OUTPUT_KINDS, METRIC_NAMES } from '../db/index.js';
import { parseCron } from '../scheduler/cron.js';

const TEMPLATES = path.join(config.root, 'engine/templates');
const SCHEDULE = process.env.SCHEDULE_FILE || path.join(config.root, 'engine/scheduler/schedule.yaml');
const CONTEXT_KEYS = ['recent_themes', 'post_reactions', 'rejections', 'latest_report', 'division_metrics'];

const pick = (obj, ...keys) => { for (const k of keys) if (obj[k] != null) return obj[k]; return undefined; };

/** 仕様書を読み取り、検証して正規化する（日本語キー・英語キーどちらでも可） */
export function normalizeSpec(raw) {
  const errors = [];
  const out = pick(raw, '成果物', 'outputs') || {};
  const goal = pick(raw, '今週の目標', 'weekly_goal');
  const checks = pick(raw, 'チェック', 'checks') || {};
  const spec = {
    slug: String(raw.slug || '').trim(),
    name: String(pick(raw, '名前', 'name') || '').trim(),
    what: String(pick(raw, 'やること', 'what') || '').trim(),
    kind: String(pick(out, '種類', 'kind') || '').trim(),
    count: Number(pick(out, '数', 'count') ?? 1),
    format: String(pick(out, '形式', 'format') || '').trim(),
    cron: String(pick(raw, '頻度', 'schedule', 'cron') || '').trim(),
    prohibited: [].concat(pick(raw, '禁止事項', 'prohibited') || []).map(String).filter(Boolean),
    context: [].concat(pick(raw, '参照するデータ', 'context') || ['recent_themes', 'rejections']).map(String),
    weekly_goal: goal ? { metric: pick(goal, '指標', 'metric'), target: Number(pick(goal, '目標値', 'target')) } : null,
    checks: { max_seconds: pick(checks, '最大秒数', 'max_seconds') ?? null },
    // 口調・実体験・テーマを別アカウント用に分けるとき（例: sub → knowledge/accounts/sub/）
    account: pick(raw, 'アカウント', 'account') == null ? null : String(pick(raw, 'アカウント', 'account')).trim(),
  };
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(spec.slug)) errors.push('slug は英小文字・数字・ハイフンで2〜31文字にしてください');
  if (['analyst', 'metrics'].includes(spec.slug)) errors.push(`slug「${spec.slug}」は予約済みです`);
  if (!spec.name) errors.push('名前 を書いてください');
  if (!spec.what) errors.push('やること を書いてください');
  if (!OUTPUT_KINDS.includes(spec.kind)) errors.push(`成果物.種類 は ${OUTPUT_KINDS.join(' / ')} のどれかにしてください`);
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > 10) errors.push('成果物.数 は1〜10の整数にしてください');
  if (!spec.format) errors.push('成果物.形式 を書いてください');
  try { parseCron(spec.cron); } catch (e) { errors.push(`頻度: ${e.message}`); }
  if (spec.prohibited.length === 0) errors.push('禁止事項 を1つ以上書いてください');
  for (const c of spec.context) {
    if (!CONTEXT_KEYS.includes(c) && !/^top_posts:[a-z0-9-]+$/.test(c)) errors.push(`参照するデータ「${c}」は使えません（${CONTEXT_KEYS.join(' / ')} / top_posts:<slug>）`);
  }
  if (spec.account != null && !/^[a-z0-9][a-z0-9-]{0,30}$/.test(spec.account)) errors.push('アカウント は英小文字・数字・ハイフンにしてください（例: sub）');
  if (spec.weekly_goal && (!METRIC_NAMES.includes(spec.weekly_goal.metric) || !(spec.weekly_goal.target > 0))) errors.push('今週の目標 の指標・目標値が不正です');
  return { spec, errors };
}

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

/** 口調・実体験・テーマの参照先。アカウント指定があれば knowledge/accounts/<account>/ */
export function knowledgePaths(account) {
  if (!account) return { voice_path: 'knowledge/my-voice.md', experience_path: 'knowledge/my-experience.md', themes_path: 'knowledge/themes.md' };
  const base = `knowledge/accounts/${account}`;
  return { voice_path: `${base}/voice.md`, experience_path: `${base}/experience.md`, themes_path: `${base}/themes.md` };
}

/** X投稿の事業部には「伸びた型＋新しい仮説」のルールを入れる（x-note と同じ運用） */
export function hypothesisRule(spec) {
  if (spec.kind !== 'x_post') return '';
  const n = spec.count;
  const split = n >= 2
    ? `${n}本のうち${n - 1}本は直近で伸びた型、1本は新しい仮説を試す。各投稿の meta.hypothesis に何を試したかを1行で書く。`
    : '直近で伸びた型をなぞるか新しい仮説を試すかを決め、meta.hypothesis に何を試したかを1行で書く。';
  return `## 仮説の記録（X投稿）
- **${split}**
- 「伸びた型」は、エンジンからの「投稿ごとの反応」で数字が良かった投稿の型をなぞる。反応データがなければ承認された投稿の型をなぞり、その旨を書く。
- 「新しい仮説」は、まだ試していない型を1か所だけ変えて試す。
- 何を試したかを、出力 JSON の各投稿の \`hypothesis\` に1行（60字前後）で書き（エンジンが meta.hypothesis に保存する）、先頭に【伸びた型】か【新仮説】を付ける。
- 過去の hypothesis と反応を見て、外れた仮説は繰り返さない。

`;
}

export function createDivision(spec, { force = false, rec = null } = {}) {
  const skillDir = path.join(config.skillsDir, spec.slug);
  const divDir = path.join(config.divisionsDir, spec.slug);
  if (!force && (fs.existsSync(skillDir) || fs.existsSync(divDir))) {
    throw new Error(`${spec.slug} はすでにあります。上書きする場合は --force を付けてください`);
  }
  const indent = (s) => s.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');

  // 1) Skill
  const skill = fill(fs.readFileSync(path.join(TEMPLATES, 'SKILL.template.md'), 'utf8'), {
    slug: spec.slug, name: spec.name, kind: spec.kind, count: spec.count,
    summary: spec.what.split('\n')[0].slice(0, 80),
    what: spec.what, format: indent(spec.format),
    prohibited: spec.prohibited.map((p) => `- ${p}`).join('\n'),
    hypothesis_rule: hypothesisRule(spec),
    ...knowledgePaths(spec.account),
    hypothesis_field: spec.kind === 'x_post' ? '【伸びた型】または【新仮説】で始まる1行（必須）' : 'この成果物で確かめたいこと（1行・任意）',
  });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill);

  // 2) 事業部の設定
  const division = {
    slug: spec.slug, name: spec.name, skill: spec.slug,
    ...(spec.weekly_goal ? { weekly_goal: spec.weekly_goal } : {}),
    ...(spec.checks.max_seconds ? { checks: { max_seconds: Number(spec.checks.max_seconds) } } : {}),
    jobs: {
      main: {
        title: `${spec.kind === 'script' ? '台本' : spec.kind}${spec.count}本`,
        expect: { [spec.kind]: spec.count },
        context: spec.context,
        instruction: `禁止事項: ${spec.prohibited.join(' / ')}`,
      },
    },
  };
  fs.mkdirSync(divDir, { recursive: true });
  fs.writeFileSync(path.join(divDir, 'division.yaml'),
    `# ${spec.name}（npm run new-division で生成。元の仕様書は spec.yaml）\n${YAML.stringify(division)}`);
  fs.writeFileSync(path.join(divDir, 'spec.yaml'), YAML.stringify({ slug: spec.slug, 名前: spec.name, やること: spec.what,
    成果物: { 種類: spec.kind, 数: spec.count, 形式: spec.format }, 頻度: spec.cron, 禁止事項: spec.prohibited,
    参照するデータ: spec.context, ...(spec.account ? { アカウント: spec.account } : {}), ...(spec.weekly_goal ? { 今週の目標: { 指標: spec.weekly_goal.metric, 目標値: spec.weekly_goal.target } } : {}) }));

  // 3) スケジュールに追記（コメントを残すためテキストで追記。既にあれば書き換えない）
  const sched = fs.readFileSync(SCHEDULE, 'utf8');
  const parsed = YAML.parse(sched) || {};
  if (!(parsed.jobs || []).some((j) => j.division === spec.slug)) {
    fs.writeFileSync(SCHEDULE, `${sched.trimEnd()}\n  - division: ${spec.slug}\n    job: main\n    cron: "${spec.cron}"       # ${spec.name}\n`);
  }

  // 4) DB に登録
  if (rec) rec.ensure_division({ slug: spec.slug, name: spec.name, skill_name: spec.slug, weekly_goal: spec.weekly_goal });

  const kp = knowledgePaths(spec.account);
  const missingKnowledge = [kp.voice_path, kp.experience_path, kp.themes_path].filter((p) => !fs.existsSync(path.join(config.root, p)));
  return {
    missingKnowledge,
    files: [path.join(skillDir, 'SKILL.md'), path.join(divDir, 'division.yaml'), path.join(divDir, 'spec.yaml'), SCHEDULE]
      .map((f) => path.relative(config.root, f)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--account');
  if (pos[0] === 'init') {
    const slug = pos[1];
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) throw new Error('使い方: npm run new-division -- init <slug>（英小文字・数字・ハイフン）');
    const dest = path.join(config.root, 'specs', `${slug}.yaml`);
    if (fs.existsSync(dest) && !force) throw new Error(`${path.relative(config.root, dest)} はすでにあります`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(path.join(TEMPLATES, 'division-spec.example.yaml'), 'utf8').replace(/^slug: .*$/m, `slug: ${slug}`));
    console.log(`作成しました: ${path.relative(config.root, dest)}\n書き換えたら: npm run new-division -- ${path.relative(config.root, dest)}`);
    return;
  }
  if (!pos[0]) throw new Error('使い方:\n  npm run new-division -- init <slug>\n  npm run new-division -- specs/<slug>.yaml');
  const raw = YAML.parse(fs.readFileSync(pos[0], 'utf8')) || {};
  // --account sub … 仕様書に書いていなくても、口調・実体験の参照先を knowledge/accounts/sub/ にする
  const accIdx = args.indexOf('--account');
  if (accIdx >= 0) raw.アカウント = args[accIdx + 1];
  const { spec, errors } = normalizeSpec(raw);
  if (errors.length) throw new Error(`仕様書に問題があります:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  const { getDb, createRecorder } = await import('../db/index.js');
  const result = createDivision(spec, { force, rec: createRecorder(getDb()) });
  console.log(`✓ ${spec.name}（${spec.slug}）を追加しました`);
  for (const f of result.files) console.log(`  - ${f}`);
  if (result.missingKnowledge.length) console.log(`\n注意: 次のファイルがまだありません。書いておくと口調・実体験がそろいます:\n${result.missingKnowledge.map((f) => `  - ${f}`).join('\n')}`);
  console.log(`\n試しに1回動かす:  npm run division -- ${spec.slug}\n定時実行: ${spec.cron}（npm run scheduler で常駐）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
