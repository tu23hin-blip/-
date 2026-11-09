// 分析担当: 数字をエンジンが集計し、analyst サブエージェントに解釈と方針案を書かせる。
//   weekly  … 月曜: 先週（月〜日）と前週を比べる
//   midweek … 木曜: 直近7日（昨日まで）とその前7日を比べる
// レポートは outputs/reports/ と knowledge/reports/ に保存。weekly_goal の更新案は承認待ちに出す（勝手に変えない）。
import fs from 'node:fs';
import path from 'node:path';
import { config, localDate, addDays, mondayOf } from '../../config.js';
import { METRIC_NAMES } from '../../db/index.js';
import { METRIC_LABELS, LATEST_POST_METRICS_SQL, goalLabel, parseGoal, avgUnitPrice } from '../../db/queries.js';

const SNAPSHOT = new Set(['followers']);
const HOW_TO_INPUT = {
  revenue_jpy: '売上（note の売上管理・ASP の管理画面などの日別の金額）',
  sales_count: '販売件数（その日に売れた件数。ダッシュボードの「売上・件数の入力」から入れられます）',
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
  // 投稿ごとの数字は入力日時点の累計なので、最新の値で並べる
  const rows = db.prepare(`SELECT o.id, o.title, o.kind, o.preview_text, o.meta, o.published_url,
      pm.impressions, pm.clicks, pm.metrics_date
    FROM outputs o JOIN (${LATEST_POST_METRICS_SQL}) pm ON pm.output_id = o.id
    WHERE o.division_id = ? AND o.created_at BETWEEN ? AND ? AND pm.impressions IS NOT NULL
    ORDER BY pm.impressions DESC`).all(divisionId, fromIso, toIso);
  const fmt = (r) => {
    const meta = JSON.parse(r.meta || '{}');
    return { id: r.id, title: r.title, theme: meta.theme ?? null, hypothesis: meta.hypothesis ?? null,
      impressions: r.impressions, clicks: r.clicks, as_of: r.metrics_date, preview: String(r.preview_text || '').slice(0, 80), url: r.published_url };
  };
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

export const MODES = {
  weekly: { title: '週次レポート', file: 'weekly', lastLabel: '先週', prevLabel: '前週' },
  midweek: { title: '中間レポート', file: 'midweek', lastLabel: '直近7日', prevLabel: 'その前7日' },
};

/** 比べる2つの期間（どちらも7日間） */
export function periodsFor(mode, today) {
  if (mode === 'midweek') {
    const end = addDays(today, -1); // 今日は途中なので昨日まで
    return { last: [addDays(end, -6), end], prev: [addDays(end, -13), addDays(end, -7)] };
  }
  const lastMon = addDays(mondayOf(today), -7);
  return { last: [lastMon, addDays(lastMon, 6)], prev: [addDays(lastMon, -7), addDays(lastMon, -1)] };
}

export function collectWeeklyData(db, today = localDate(), mode = 'weekly') {
  if (!MODES[mode]) throw new Error(`不明なモード: ${mode}`);
  const { last: [lastMon, lastSun], prev: [prevMon, prevSun] } = periodsFor(mode, today);
  const divisions = db.prepare("SELECT * FROM divisions WHERE slug != 'analyst' ORDER BY id").all();
  return {
    mode, labels: { last: MODES[mode].lastLabel, prev: MODES[mode].prevLabel },
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
        avg_unit_price: { last_week: avgUnitPrice(db, lastMon, lastSun, d.id), prev_week: avgUnitPrice(db, prevMon, prevSun, d.id) },
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
  const mode = MODES[data.mode || 'weekly'];
  const L = data.labels || { last: '先週', prev: '前週' };
  const [lm, ls] = data.period.last_week;
  const [pm, ps] = data.period.prev_week;
  const lines = [`# ${mode.title} ${lm} 〜 ${ls}`, '',
    `作成: ${data.period.today}（分析担当 / AI）・比較: ${L.last}（${lm}〜${ls}）と ${L.prev}（${pm}〜${ps}）`, '',
    '> 数字は DB（metrics / outputs）から集計した値だけを載せています。「不明」は記録がないもので、0 ではありません。', ''];
  if (ai?.overall) lines.push('## 全体', '', ai.overall, '');
  for (const d of data.divisions) {
    const a = aiBy[d.slug] || {};
    lines.push(`## ${d.name}${d.status === 'paused' ? '（一時停止中）' : ''}`, '');
    lines.push(`### ${L.last}の数字`, '', `| 指標 | ${L.last} | ${L.prev} | 比較 | 記録日数 |`, '|---|---|---|---|---|');
    for (const n of METRIC_NAMES) {
      const l = d.last_week[n], p = d.prev_week[n];
      lines.push(`| ${METRIC_LABELS[n]} | ${fmtV(n, l.value)} | ${fmtV(n, p.value)} | ${delta(l.value, p.value)} | ${l.days_with_data}/7 |`);
    }
    const au = d.avg_unit_price || {};
    lines.push(`| 平均単価（売上÷件数） | ${fmtV('revenue_jpy', au.last_week)} | ${fmtV('revenue_jpy', au.prev_week)} | ${delta(au.last_week, au.prev_week)} | 売上と件数が両方ある日のみ |`);
    lines.push('');
    if (d.weekly_goal) lines.push(`- 今週の目標（現在）: ${d.goal_label} ／ ${L.last}の実績: ${fmtV(d.weekly_goal.metric, d.goal_actual_last_week)}（達成率 ${d.goal_rate_last_week == null ? '不明' : d.goal_rate_last_week + '%'}）`);
    lines.push(`- 成果物: 作成 ${d.outputs.total ?? 0} ／ 承認 ${d.outputs.approved ?? 0} ／ 却下 ${d.outputs.rejected ?? 0} ／ 承認待ち ${d.outputs.pending ?? 0} ／ 投稿済み ${d.outputs.published ?? 0} ／ 失敗タスク ${d.outputs.failed_tasks}`);
    if (a.summary) lines.push('', a.summary);
    lines.push('', '### 伸びた投稿 / 伸びなかった投稿', '');
    const postLine = (p) => `- ${p.title}（インプ ${fmtV('impressions', p.impressions)}・${p.as_of}時点）${p.hypothesis ? ` 仮説: ${p.hypothesis}` : ''}${p.url ? ` ${p.url}` : ''}`;
    if (d.per_post_data_missing) lines.push('- 投稿ごとの数字がありません（下の「入力してほしい数字」を参照）');
    else {
      lines.push('伸びた:', ...d.posts.top.map(postLine));
      if (d.posts.bottom.length) lines.push('', '伸びなかった:', ...d.posts.bottom.map(postLine));
    }
    if (a.good_posts) lines.push('', `- 伸びた理由の仮説: ${a.good_posts}`);
    if (a.bad_posts) lines.push(`- 伸びなかった理由の仮説: ${a.bad_posts}`);
    lines.push('', `### ${data.mode === 'midweek' ? '週の後半' : '来週'}の方針案`, '');
    const pol = Array.isArray(a.policies) ? a.policies.slice(0, 3) : [];
    lines.push(...(pol.length ? pol.map((p, i) => `${i + 1}. ${p}`) : ['- （AIの方針案なし）']));
    if (a.goal_proposal && a.goal_proposal.target != null) {
      lines.push('', `### 今週の目標の更新案（承認待ち）`, '', `- ${goalLabel(a.goal_proposal) || JSON.stringify(a.goal_proposal)} — ${a.goal_proposal.reason || ''}`,
        '- 承認待ちの受け箱で承認すると反映されます（自動では変わりません）');
    }
    if (d.missing_inputs.length || d.per_post_data_missing) {
      lines.push('', '### 入力してほしい数字', '',
        '- 売上・販売件数: 経営ダッシュボードの「売上・件数の入力」',
        '- 投稿ごとのインプレッション・クリック: 承認待ちタブの「投稿済み」カードの入力欄（その時点の累計）',
        '- それ以外・まとめて入れるとき: `npm run metrics:import -- ファイル.csv`（列: `date,division,name,value[,url]`）', '');
      for (const m of d.missing_inputs) lines.push(`- \`${d.slug},${m.metric}\` … ${m.how}`);
      if (d.per_post_data_missing) lines.push(`- 投稿ごとのインプレッション … 投稿済みカードで入力、または CSV の url 列に投稿URLを入れて \`${d.slug},impressions\` を記録（例: \`${ls},${d.slug},impressions,1234,https://x.com/...\`）`);
    }
    lines.push('');
  }
  lines.push('---', '※AIを活用して作成（数字の集計はプログラム、解釈と方針案はAI）');
  return lines.join('\n') + '\n';
}

const GOAL_METRICS = ['revenue_jpy', 'sales_count', 'impressions', 'clicks', 'followers', 'posts', 'work_minutes'];

export async function run({ cfg, jobId, rec, div, helpers }) {
  if (!MODES[jobId]) throw new Error(`分析担当のジョブは ${Object.keys(MODES).join(' / ')} です（${jobId}）`);
  const mode = MODES[jobId];
  const db = rec.db;
  const today = localDate();
  const data = collectWeeklyData(db, today, jobId);
  const [lm, ls] = data.period.last_week;
  const taskId = rec.start_task({ division: div.id, title: `${mode.title}（${lm}〜${ls}）`, detail: { job: jobId } });
  try {
    rec.log_event({ task_id: taskId, message: `数字を集計: ${data.divisions.length}事業部（${data.labels.last} ${lm}〜${ls} と ${data.labels.prev}）` });
    const prompt = `${mode.title}を作ってください（ジョブ: ${jobId}）。あなたは analyst サブエージェントです（.claude/agents/analyst.md の指示に従う）。
比べる期間: 「${data.labels.last}」（last_week: ${lm}〜${ls}）と「${data.labels.prev}」（prev_week）。JSON の last_week / prev_week はこの2つの期間を指します。
${jobId === 'midweek' ? '週の途中の点検です。方針案は「今週の残り（金〜日）と来週」に向けて書いてください。\n' : ''}
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
    const name = `${today}-${mode.file}.md`;
    const outFile = path.join(config.outputsDir, 'reports', name);
    const kbFile = path.join(config.knowledgeDir, 'reports', name);
    for (const f of [outFile, kbFile]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, md); }
    rec.save_output({ task_id: taskId, kind: 'report', file_path: outFile, preview_text: (ai.overall || md).slice(0, 160),
      title: `${mode.title} ${lm}〜${ls}`, approval: 'approved',
      meta: { type: 'weekly_report', job: jobId, period: [lm, ls], knowledge_copy: path.relative(config.root, kbFile) } });

    // 目標の更新案 → 承認待ち（勝手に書き換えない）。同じ案がすでに承認待ちなら重ねて出さない
    for (const a of ai.divisions || []) {
      const g = a.goal_proposal;
      const target = data.divisions.find((d) => d.slug === a.slug);
      if (!g || !target || !GOAL_METRICS.includes(g.metric) || !(Number(g.target) > 0)) continue;
      const newGoal = { metric: g.metric, target: Math.round(Number(g.target)) };
      const cur = target.weekly_goal;
      if (cur && cur.metric === newGoal.metric && cur.target === newGoal.target) continue;
      const dup = db.prepare(`SELECT id FROM outputs WHERE approval = 'pending' AND json_extract(meta,'$.type') = 'goal_update'
        AND json_extract(meta,'$.division_slug') = ? AND json_extract(meta,'$.new_goal.metric') = ? AND json_extract(meta,'$.new_goal.target') = ?`)
        .get(a.slug, newGoal.metric, newGoal.target);
      if (dup) { rec.log_event({ task_id: taskId, message: `目標の更新案（${target.name}: ${goalLabel(newGoal)}）は承認待ちに同じ案があるため出しません` }); continue; }
      const body = `# 今週の目標の更新案: ${target.name}\n\n- 現在: ${target.goal_label || '未設定'}\n- 提案: ${goalLabel(newGoal)}\n- ${data.labels.last}の実績: ${fmtV(newGoal.metric, target.last_week[newGoal.metric]?.value)}\n- 理由: ${g.reason || '（理由なし）'}\n- 出どころ: ${mode.title}（${lm}〜${ls}）\n\n承認すると divisions.weekly_goal が書き換わります。却下すれば現在の目標のままです。\n`;
      const f = path.join(config.outputsDir, 'reports', `${today}-${mode.file}-goal-${a.slug}.md`);
      fs.writeFileSync(f, body);
      rec.save_output({ task_id: taskId, kind: 'report', file_path: f, preview_text: `${target.goal_label || '未設定'} → ${goalLabel(newGoal)}（${g.reason || ''}）`.slice(0, 160),
        title: `目標の更新案: ${target.name}`, meta: { type: 'goal_update', job: jobId, division_slug: a.slug, new_goal: newGoal, old_goal: cur, reason: g.reason || null } });
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
