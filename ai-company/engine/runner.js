// 事業部の1回分の実行。どの事業部も同じ流れ:
//   ロック → 一時停止/コスト上限チェック → start_task → claude -p で Skill → outputs/ に保存
//   → save_output(approval=pending) → finish_task（失敗時は fail_task）
// engine/divisions/<slug>/run.js があればそちらに任せる（分析担当など）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, localDate } from './config.js';
import { getDb, createRecorder, OUTPUT_KINDS } from './db/index.js';
import { loadDivisionConfig } from './registry.js';
import { runClaude, extractJson } from './claude.js';
import { checkOutput } from './compliance.js';
import { buildContext } from './context.js';
import { acquireLock } from './lock.js';
import { enforceCostLimit, usdToJpy } from './cost-guard.js';
import { readOutputFile } from './db/queries.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const stamp = () => new Date().toTimeString().slice(0, 8).replace(/:/g, '');

export function divisionRow(rec, cfg) {
  rec.ensure_division({ slug: cfg.slug, name: cfg.name, skill_name: cfg.skill || null, weekly_goal: cfg.weekly_goal ?? null, status: cfg.initial_status });
  return rec.resolveDivision(cfg.slug);
}

/** APIコストを記録（為替未設定なら概算である旨をイベントに残す） */
export function recordCost(rec, { division, taskId, costUsd }) {
  if (costUsd == null) {
    rec.log_event({ task_id: taskId, message: 'APIコストを取得できませんでした（記録なし）' });
    return;
  }
  const { jpy, assumed, rate } = usdToJpy(costUsd);
  rec.add_metric({ division, name: 'api_cost_jpy', value: jpy });
  rec.log_event({ task_id: taskId, message: `APIコスト: $${costUsd.toFixed(4)} ≒ ¥${jpy}${assumed ? `（USD_JPY_RATE 未設定のため 1ドル=${rate}円で概算）` : ''}` });
}

function writeOutputFile(slug, kind, n, body) {
  const dir = path.join(config.outputsDir, slug, localDate());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp()}-${kind}-${n}.md`);
  fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n');
  return file;
}

function saveRaw(slug, taskId, text) {
  const dir = path.join(config.outputsDir, slug, localDate());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${stamp()}-task${taskId}-raw.txt`), text);
}

function buildPrompt({ cfg, jobId, job, context, extra = '' }) {
  const today = localDate();
  const dow = WEEKDAYS[new Date().getDay()];
  const expect = Object.entries(job.expect || {}).map(([k, v]) => `${k} × ${v}`).join('、');
  return `あなたは「AI会社」の${cfg.name}の担当です。
Skill ツールで「${cfg.skill}」Skill を読み込み、その手順に従って作業してください。
（Skill を読み込めない場合は .claude/skills/${cfg.skill}/SKILL.md を Read で読んでください）

## エンジンからの情報
- 今日: ${today}（${dow}）
- ジョブ: ${jobId}（${job.title}）
- 期待する成果物: ${expect || '（Skillの指示どおり）'}
${job.instruction ? `- 追加の指示: ${job.instruction}\n` : ''}
${context}
${extra}

## 絶対のルール（CLAUDE.md）
- 投稿・公開・送信・購入はしない。ファイルの書き込みもしない（保存はエンジンが行う）。
- 数字や実績を捏造しない。不明なことは questions に書く。
- 最後に Skill の「出力形式」の JSON を \`\`\`json ブロックで1つだけ出す。`;
}

/** AIの返答から成果物を取り出して保存する */
function saveOutputs({ rec, cfg, taskId, parsed, expect, jobId }) {
  const outputs = Array.isArray(parsed.outputs) ? parsed.outputs : [];
  const allowed = new Set(Object.keys(expect || {}).length ? Object.keys(expect) : OUTPUT_KINDS);
  const counts = {};
  const ids = [];
  for (const o of outputs) {
    if (!o || !allowed.has(o.kind) || !OUTPUT_KINDS.includes(o.kind)) {
      rec.log_event({ task_id: taskId, message: `想定外の成果物を無視しました: ${o?.kind}` });
      continue;
    }
    counts[o.kind] = (counts[o.kind] || 0) + 1;
    if (expect?.[o.kind] && counts[o.kind] > expect[o.kind]) continue;
    const { body, warnings } = checkOutput(o.kind, o.body, { ...(cfg.checks || {}), prohibited: cfg.prohibited_words || [] });
    if (!body.trim()) continue;
    // 仮説（1行）。X投稿は「伸びた型」か「新しい仮説」かを必ず書かせる
    const hypothesis = o.hypothesis ? String(o.hypothesis).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    if (!hypothesis && o.kind === 'x_post' && jobId !== 'revise') warnings.push('仮説（hypothesis）が書かれていません');
    const file = writeOutputFile(cfg.slug, o.kind, counts[o.kind], body);
    const meta = {
      theme: parsed.theme || null, theme_reason: parsed.theme_reason || null, hypothesis, notes: o.notes || null, job: jobId,
      warnings, questions: Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean) : [],
    };
    ids.push(rec.save_output({ task_id: taskId, kind: o.kind, file_path: file, preview_text: body.slice(0, 160),
      title: String(o.title || `${parsed.theme || o.kind} #${counts[o.kind]}`).slice(0, 60), meta }));
    if (warnings.length) rec.log_event({ task_id: taskId, message: `要確認: ${o.title || o.kind} — ${warnings.join(' / ')}` });
  }
  for (const [k, n] of Object.entries(expect || {})) {
    if ((counts[k] || 0) < n) rec.log_event({ task_id: taskId, message: `成果物が想定より少ない: ${k} ${counts[k] || 0}/${n}` });
  }
  if (ids.length === 0) throw new Error('成果物が1つも得られませんでした');
  return ids;
}

/** 修正依頼（queued）を処理 */
async function processRevisions({ rec, cfg, div }) {
  const queued = rec.db.prepare("SELECT * FROM tasks WHERE division_id = ? AND status = 'queued' ORDER BY id").all(div.id);
  let failed = 0;
  for (const t of queued) {
    let detail = {};
    try { detail = JSON.parse(t.detail || '{}'); } catch {}
    if (!detail.revise_output_id) continue;
    rec.start_task({ task_id: t.id });
    try {
      const orig = rec.db.prepare('SELECT * FROM outputs WHERE id = ?').get(detail.revise_output_id);
      if (!orig) throw new Error(`元の成果物 #${detail.revise_output_id} が見つかりません`);
      const content = readOutputFile(orig.file_path) ?? orig.preview_text;
      const job = { title: '修正依頼', expect: { [orig.kind]: 1 } };
      const extra = `### 元の下書き（${orig.kind}）\n${content}\n\n### 人間からの修正コメント\n${detail.comment}`;
      const prompt = buildPrompt({ cfg, jobId: 'revise', job, context: buildContext(rec.db, div, ['rejections']), extra });
      rec.log_event({ task_id: t.id, message: `修正版を作成中（claude -p / Skill ${cfg.skill}）` });
      const res = await runClaude({ prompt });
      recordCost(rec, { division: div.id, taskId: t.id, costUsd: res.costUsd });
      saveRaw(cfg.slug, t.id, res.text);
      saveOutputs({ rec, cfg, taskId: t.id, parsed: extractJson(res.text), expect: job.expect, jobId: 'revise' });
      rec.finish_task(t.id);
    } catch (e) {
      if (e.costUsd != null) recordCost(rec, { division: div.id, taskId: t.id, costUsd: e.costUsd });
      rec.fail_task(t.id, e);
      failed++;
    }
  }
  return failed;
}

/**
 * 事業部のジョブを1回実行する。
 * @returns {Promise<{status:'done'|'failed'|'skipped', reason?:string, taskId?:number}>}
 */
export async function runJob(slug, jobId, { force = false, rec = createRecorder(getDb()), options = {} } = {}) {
  const cfg = loadDivisionConfig(slug);
  const div = divisionRow(rec, cfg);

  const lockInfo = {};
  const release = acquireLock(slug, lockInfo);
  if (!release) {
    rec.log_event({ division: div.id, message: `二重起動を防止: ${jobId} はスキップ（pid ${lockInfo.holder?.pid} が実行中）` });
    return { status: 'skipped', reason: 'locked' };
  }
  try {
    // ロックが取れた = この事業部で動いているプロセスはない。running のまま残ったタスクは中断扱いにする
    for (const t of rec.db.prepare("SELECT id FROM tasks WHERE division_id = ? AND status = 'running'").all(div.id)) {
      rec.fail_task(t.id, '中断されました（前回の実行が途中で停止）');
    }
    if (div.status === 'paused' && !force) {
      rec.log_event({ division: div.id, message: `一時停止中のため ${jobId} はスキップ` });
      return { status: 'skipped', reason: 'paused' };
    }
    if (enforceCostLimit(rec)) {
      return { status: 'skipped', reason: 'cost_limit' };
    }

    const custom = path.join(cfg.dir, 'run.js');
    if (fs.existsSync(custom)) {
      const mod = await import(pathToFileURL(custom).href);
      return await mod.run({ cfg, jobId, rec, div, options: { force, ...options }, helpers: { buildPrompt, recordCost, runClaude, extractJson } });
    }

    const revFailed = await processRevisions({ rec, cfg, div });
    if (jobId === 'revise') return { status: revFailed ? 'failed' : 'done' };

    const job = cfg.jobs?.[jobId];
    if (!job) throw new Error(`${slug} にジョブ「${jobId}」がありません（division.yaml の jobs を確認）`);

    const taskId = rec.start_task({ division: div.id, title: `${job.title}（${localDate()}）`, detail: { job: jobId } });
    try {
      const prompt = buildPrompt({ cfg, jobId, job, context: buildContext(rec.db, div, job.context || []) });
      rec.log_event({ task_id: taskId, message: `Skill「${cfg.skill}」を claude -p で実行中` });
      const res = await runClaude({ prompt });
      recordCost(rec, { division: div.id, taskId, costUsd: res.costUsd });
      saveRaw(cfg.slug, taskId, res.text);
      const parsed = extractJson(res.text);
      if (parsed.theme) rec.log_event({ task_id: taskId, message: `テーマ: ${parsed.theme}${parsed.theme_reason ? `（${parsed.theme_reason}）` : ''}` });
      saveOutputs({ rec, cfg, taskId, parsed, expect: job.expect, jobId });
      const status = rec.finish_task(taskId);
      return { status: 'done', taskId, taskStatus: status };
    } catch (e) {
      if (e.costUsd != null) recordCost(rec, { division: div.id, taskId, costUsd: e.costUsd });
      rec.fail_task(taskId, e);
      return { status: 'failed', taskId, reason: e.message };
    }
  } finally {
    try { enforceCostLimit(rec); } catch {}
    release();
  }
}
