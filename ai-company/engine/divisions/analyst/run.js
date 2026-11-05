// 分析担当: 先週（月〜日）の数字をエンジンが集計し、analyst サブエージェントに解釈と方針案を書かせる。
// レポートは outputs/reports/ と knowledge/reports/ に保存。weekly_goal の更新案は承認待ちに出す（勝手に変えない）。
import fs from 'node:fs';
import path from 'node:path';
import { config, localDate, addDays, mondayOf } from '../../config.js';
import { METRIC_NAMES } from '../../db/index.js';
import { METRIC_LABELS, goalLabel, parseGoal } from '../../db/queries.js';

const SNAPSHOT = new Set(['followers']);
const HOW_TO_INPUT = {
  revenue_jpy: '売上（note の売上管理・ASP の管理画面などの日別の金額）',
  impressions: 'インプレッション（X アナリティクス／各媒体のアナリティクスの日別表示回数）',
  clicks: 'クリック（リンククリック数・サイト流入数）',
  followers: 'フォロワー数（その日の時点の人数）',
  posts: '投稿数（承認待ちの受け箱で「投稿済みにする」と自動で記録されます）',
  work_minutes: '作業時間（あなたがこの事業部に使った分数）',
};

function metricSummary(db, divisionId, from, to) {
  const out = {};
  for (const name of METRIC_NAMES) {
    const rows = db.prepare(`SELECT date, value FROM metrics WHERE division_id = ? AND name = ? AND output_id IS NULL
      AND date BETWEEN ? AND ? AND value IS NOT NULL ORDER BY date`).all(divisionId, name, from, to);
    const value = rows.length === 0 ? null : SNAPSHOT.has(name) ? rows.at(-1).value : rows.reduce((s, r) => s + r.value, 0);
    out[name] = { value, days_with_data: rows.length };
  }
  return out;
}

function postRanking(db, divisionId, fromIso, toIso) {
  const rows = db.prepare(`SELECT o.id, o.title, o.kind, o.preview_text, o.meta, o.published_url,
      SUM(CASE WHEN m.name='impressions' THEN m.value END) impressions,
      SUM(CASE WHEN m.name='clicks' THEN m.value END) clicks
    FROM outputs o JOIN metrics m ON m.output_id = o.id
    WHERE o.division_id = ? AND o.created_at BETWEEN ? AND ?
    GROUP BY o.id HAVING impressions IS NOT NULL ORDER BY impressions DESC`).all(divisionId, fromIso, toIso);
  const fmt = (r) => ({ id: r.id, title: r.title, theme: JSON.parse(r.meta || '{}').theme ?? null,
    impressions: r.impressions, clicks: r.clicks, preview: String(r.preview_text || '').slice(0, 80), url: r.published_url });
  return { top: rows.slice(0, 3).map(fmt), bottom: rows.length > 3 ? rows.slice(-3).reverse().map(fmt) : [], posts_with_data: rows.length };
}

function outputCounts(db, divisionId, fromIso, toIso) {
  const r = db.prepare(`SELECT COUNT(*) total,
      SUM(approval='approved') approved, SUM(approval='rejected') rejected, SUM(approval='pending') pending,
      SUM(published_url IS NOT NULL) published
    FROM outputs WHERE division_id = ? AND kind != 'report' AND created_at BETWEEN ? AND ?`).get(divisionId, fromIso, toIso);
  const failed = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE division_id = ? AND status = 'failed' AND started_at BETWEEN ? AND ?`).get(divisionId, fromIso, toIso).c;
  return { ...r, failed_tasks: failed };
}

const isoStart = (d) => new Date(`${d}T00:00:00`).toISOString();
const isoEnd = (d) => new Date(`${d}T23:59:59.999`).toISOString();

export function collectWeeklyData(db, today = localDate()) {
  const lastMon = addDays(mondayOf(today), -7);
  const lastSun = addDays(lastMon, 6);
  const prevMon = addDays(lastMon, -7);
  const prevSun = addDays(lastMon, -1);
  const divisions = db.prepare("SELECT * FROM divisions WHERE slug != 'analyst' ORDER BY id").all();
  return {
    period: { last_week: [lastMon, lastSun], prev_week: [prevMon, prevSun], today },
    divisions: divisions.map((d) => {
      const last = metricSummary(db, d.id, lastMon, lastSun);
      const prev = metricSummary(db, d.id, prevMon, prevSun);
      const goal = parseGoal(d.weekly_goal);
      const goalActual = goal ? last[goal.metric]?.value ?? null : null;
      const missing = Object.keys(HOW_TO_INPUT).filter((n) => last[n].days_with_data === 0);
      const ranking = postRanking(db, d.id, isoStart(lastMon), isoEnd(lastSun));
      return {
        slug: d.slug, name: d.name, status: d.status,
        weekly_goal: goal, goal_label: goalLabel(goal),
        goal_actual_last_week: goalActual,
        goal_rate_last_week: goal && goalActual != null && goal.target ? Math.round((goalActual / goal.target) * 1000) / 10 : null,
        last_week: last, prev_week: prev,
        posts: ranking,
        outputs: outputCounts(db, d.id, isoStart(lastMon), isoEnd(lastSun)),
        missing_inputs: missing.map((n) => ({ metric: n, how: HOW_TO_INPUT[n] })),
        per_post_data_missing: ranking.posts_with_data === 0,
      };
    }),
  };
}

const fmtV = (name, v) => (v == null ? '不明' : name.endsWith('_jpy') ? `¥${Math.round(v).toLocaleString('ja-JP')}` : Math.round(v).toLocaleString('ja-JP'));
function delta(a, b) {
  if (a == null || b == null) return '—';
  if (b === 0) return a === 0 ? '±0' : '—';
  const p = ((a - b) / b) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export function renderReport(data, ai) {
  const aiBy = Object.fromEntries((ai?.divisions || []).map((d) => [d.slug, d]));
  const [lm, ls] = data.period.last_week;
  const lines = [`# 週次レポート ${lm} 〜 ${ls}`, '',
    `作成: ${data.period.today}（分析担当 / AI）`, '',
    '> 数字は DB（metrics / outputs）から集計した値だけを載せています。「不明」は記録がないもので、0 ではありません。', ''];
  if (ai?.overall) lines.push('## 全体', '', ai.overall, '');
  for (const d of data.divisions) {
    const a = aiBy[d.slug] || {};
    lines.push(`## ${d.name}${d.status === 'paused' ? '（一時停止中）' : ''}`, '');
    lines.push('### 先週の数字', '', '| 指標 | 先週 | 前週 | 前週比 | 記録日数 |', '|---|---|---|---|---|');
    for (const n of METRIC_NAMES) {
      const l = d.last_week[n], p = d.prev_week[n];
      lines.push(`| ${METRIC_LABELS[n]} | ${fmtV(n, l.value)} | ${fmtV(n, p.value)} | ${delta(l.value, p.value)} | ${l.days_with_data}/7 |`);
    }
    lines.push('');
    if (d.weekly_goal) lines.push(`- 今週の目標（現在）: ${d.goal_label} ／ 先週の実績: ${fmtV(d.weekly_goal.metric, d.goal_actual_last_week)}（達成率 ${d.goal_rate_last_week == null ? '不明' : d.goal_rate_last_week + '%'}）`);
    lines.push(`- 成果物: 作成 ${d.outputs.total ?? 0} ／ 承認 ${d.outputs.approved ?? 0} ／ 却下 ${d.outputs.rejected ?? 0} ／ 承認待ち ${d.outputs.pending ?? 0} ／ 投稿済み ${d.outputs.published ?? 0} ／ 失敗タスク ${d.outputs.failed_tasks}`);
    if (a.summary) lines.push('', a.summary);
    lines.push('', '### 伸びた投稿 / 伸びなかった投稿', '');
    if (d.per_post_data_missing) lines.push('- 投稿ごとの数字がありません（下の「入力してほしい数字」を参照）');
    else {
      lines.push('伸びた:', ...d.posts.top.map((p) => `- ${p.title}（インプ ${fmtV('impressions', p.impressions)}）${p.url ? ` ${p.url}` : ''}`));
      if (d.posts.bottom.length) lines.push('', '伸びなかった:', ...d.posts.bottom.map((p) => `- ${p.title}（インプ ${fmtV('impressions', p.impressions)}）`));
    }
    if (a.good_posts) lines.push('', `- 伸びた理由の仮説: ${a.good_posts}`);
    if (a.bad_posts) lines.push(`- 伸びなかった理由の仮説: ${a.bad_posts}`);
    lines.push('', '### 来週の方針案', '');
    const pol = Array.isArray(a.policies) ? a.policies.slice(0, 3) : [];
    lines.push(...(pol.length ? pol.map((p, i) => `${i + 1}. ${p}`) : ['- （AIの方針案なし）']));
    if (a.goal_proposal && a.goal_proposal.target != null) {
      lines.push('', `### 今週の目標の更新案（承認待ち）`, '', `- ${goalLabel(a.goal_proposal) || JSON.stringify(a.goal_proposal)} — ${a.goal_proposal.reason || ''}`,
        '- 承認待ちの受け箱で承認すると反映されます（自動では変わりません）');
    }
    if (d.missing_inputs.length || d.per_post_data_missing) {
      lines.push('', '### 入力してほしい数字', '', '`npm run metrics:import -- ファイル.csv`（列: `date,division,name,value[,url]`）で取り込めます。', '');
      for (const m of d.missing_inputs) lines.push(`- \`${d.slug},${m.metric}\` … ${m.how}`);
      if (d.per_post_data_missing) lines.push(`- 投稿ごとのインプレッション … CSV の url 列に投稿URLを入れて \`${d.slug},impressions\` を記録（例: \`${lm},${d.slug},impressions,1234,https://x.com/...\`）`);
    }
    lines.push('');
  }
  lines.push('---', '※AIを活用して作成（数字の集計はプログラム、解釈と方針案はAI）');
  return lines.join('\n') + '\n';
}

const GOAL_METRICS = ['revenue_jpy', 'impressions', 'clicks', 'followers', 'posts', 'work_minutes'];

export async function run({ cfg, jobId, rec, div, helpers }) {
  if (jobId !== 'weekly') throw new Error(`分析担当のジョブは weekly だけです（${jobId}）`);
  const db = rec.db;
  const today = localDate();
  const data = collectWeeklyData(db, today);
  const [lm, ls] = data.period.last_week;
  const taskId = rec.start_task({ division: div.id, title: `週次レポート（${lm}〜${ls}）`, detail: { job: jobId } });
  try {
    rec.log_event({ task_id: taskId, message: `数字を集計: ${data.divisions.length}事業部（${lm}〜${ls}）` });
    const prompt = `週次レポートを作ってください。あなたは analyst サブエージェントです（.claude/agents/analyst.md の指示に従う）。

## 集計データ（エンジンが DB から集計。数字はここにあるものだけを使う）
\`\`\`json
${JSON.stringify(data, null, 1)}
\`\`\`

必要なら knowledge/ の過去レポートやテーマを Read してよい。
最後に analyst.md の「出力形式」の JSON を \`\`\`json ブロックで1つだけ出す。divisions には上の全事業部（${data.divisions.map((d) => d.slug).join(', ')}）を入れる。`;
    rec.log_event({ task_id: taskId, message: 'analyst サブエージェントを claude -p で実行中' });
    const res = await helpers.runClaude({ prompt, agent: 'analyst' });
    helpers.recordCost(rec, { division: div.id, taskId, costUsd: res.costUsd });
    const ai = helpers.extractJson(res.text);

    const md = renderReport(data, ai);
    const name = `${today}-weekly.md`;
    const outFile = path.join(config.outputsDir, 'reports', name);
    const kbFile = path.join(config.knowledgeDir, 'reports', name);
    for (const f of [outFile, kbFile]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, md); }
    rec.save_output({ task_id: taskId, kind: 'report', file_path: outFile, preview_text: (ai.overall || md).slice(0, 160),
      title: `週次レポート ${lm}〜${ls}`, approval: 'approved', meta: { type: 'weekly_report', period: [lm, ls], knowledge_copy: path.relative(config.root, kbFile) } });

    // 目標の更新案 → 承認待ち（勝手に書き換えない）
    for (const a of ai.divisions || []) {
      const g = a.goal_proposal;
      const target = data.divisions.find((d) => d.slug === a.slug);
      if (!g || !target || !GOAL_METRICS.includes(g.metric) || !(Number(g.target) > 0)) continue;
      const newGoal = { metric: g.metric, target: Math.round(Number(g.target)) };
      const cur = target.weekly_goal;
      if (cur && cur.metric === newGoal.metric && cur.target === newGoal.target) continue;
      const body = `# 今週の目標の更新案: ${target.name}\n\n- 現在: ${target.goal_label || '未設定'}\n- 提案: ${goalLabel(newGoal)}\n- 先週の実績: ${fmtV(newGoal.metric, target.last_week[newGoal.metric]?.value)}\n- 理由: ${g.reason || '（理由なし）'}\n\n承認すると divisions.weekly_goal が書き換わります。却下すれば現在の目標のままです。\n`;
      const f = path.join(config.outputsDir, 'reports', `${today}-goal-${a.slug}.md`);
      fs.writeFileSync(f, body);
      rec.save_output({ task_id: taskId, kind: 'report', file_path: f, preview_text: `${target.goal_label || '未設定'} → ${goalLabel(newGoal)}（${g.reason || ''}）`.slice(0, 160),
        title: `目標の更新案: ${target.name}`, meta: { type: 'goal_update', division_slug: a.slug, new_goal: newGoal, old_goal: cur, reason: g.reason || null } });
    }
    const missing = data.divisions.filter((d) => d.missing_inputs.length || d.per_post_data_missing).map((d) => d.name);
    if (missing.length) rec.log_event({ task_id: taskId, message: `数字が不足: ${missing.join('、')}（レポートの「入力してほしい数字」を参照）` });
    const status = rec.finish_task(taskId);
    return { status: 'done', taskId, taskStatus: status };
  } catch (e) {
    if (e.costUsd != null) helpers.recordCost(rec, { division: div.id, taskId, costUsd: e.costUsd });
    rec.fail_task(taskId, e);
    return { status: 'failed', taskId, reason: e.message };
  }
}
