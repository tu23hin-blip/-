import { advertisers } from '../db/repositories/orgs.ts';
import { insights, metaObjects, optimizerActions } from '../db/repositories/meta.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { legalReviews } from '../db/repositories/legal.ts';
import { reports } from '../db/repositories/system.ts';
import { parseJson } from '../db/sqlite.ts';
import { addDays, endOfMonth, jstDateString } from '../lib/date.ts';
import { formatYen, pct, safeDiv } from '../lib/money.ts';
import { createLogger } from '../lib/logger.ts';
import { llm } from '../providers/registry.ts';
import { pathFor, save } from '../providers/storage/local.ts';
import { STATUS_LABELS } from '../domain/workflow.ts';
import { aggregate } from '../meta/optimizer.ts';
import { toHtml, toMarkdown, type CreativeRow, type Kpi, type ReportModel } from './render.ts';
import type { Report } from '../domain/types.ts';

const log = createLogger('report:daily');

/**
 * 日次報告書の生成。
 * 「昨日何が起きて、システムが何をして、明日何をすべきか」を1枚にまとめる。
 * 数値はすべて DB の実績から算出し、文章部分だけ LLM に書かせる（数値の捏造を防ぐ）。
 */

export async function generateDailyReport(projectId: string, date = jstDateString(new Date(Date.now() - 86_400_000))): Promise<Report> {
  const project = projects.require(projectId);
  const advertiser = advertisers.require(project.advertiser_id);

  const today = insights.byDate(projectId, date, 'campaign');
  const yesterday = insights.byDate(projectId, addDays(date, -1), 'campaign');
  const cur = aggregate(today);
  const prev = aggregate(yesterday);

  const delta = (a: number, b: number): number | null => (b === 0 ? null : ((a - b) / b) * 100);
  const cpaStatus = project.target_cpa > 0 && cur.cpa > 0
    ? cur.cpa <= project.target_cpa ? 'good' : cur.cpa <= project.target_cpa * 1.2 ? 'warn' : 'bad'
    : 'neutral';

  const kpis: Kpi[] = [
    { label: '消化金額', value: formatYen(cur.spend), delta: delta(cur.spend, prev.spend), status: 'neutral' },
    { label: 'インプレッション', value: cur.impressions.toLocaleString(), delta: delta(cur.impressions, prev.impressions), status: 'neutral' },
    { label: 'クリック', value: cur.clicks.toLocaleString(), delta: delta(cur.clicks, prev.clicks), status: 'neutral' },
    { label: 'CTR', value: `${cur.ctr.toFixed(2)}%`, delta: delta(cur.ctr, prev.ctr), status: cur.ctr >= 1 ? 'good' : 'neutral' },
    { label: 'CV', value: `${cur.conversions}件`, delta: delta(cur.conversions, prev.conversions), status: cur.conversions > 0 ? 'good' : 'warn' },
    {
      label: 'CPA', value: cur.cpa ? formatYen(cur.cpa) : '—',
      delta: delta(cur.cpa, prev.cpa),
      target: project.target_cpa ? formatYen(project.target_cpa) : null,
      status: cpaStatus as Kpi['status'],
    },
    {
      label: 'ROAS', value: `${cur.roas.toFixed(2)}`,
      delta: delta(cur.roas, prev.roas),
      target: project.target_roas ? project.target_roas.toFixed(1) : null,
      status: project.target_roas > 0 ? (cur.roas >= project.target_roas ? 'good' : 'bad') : 'neutral',
    },
    { label: 'フリークエンシー', value: cur.frequency.toFixed(2), delta: null, status: cur.frequency > 2.5 ? 'warn' : 'neutral' },
  ];

  // 予算ペース
  const monthStart = `${date.slice(0, 7)}-01`;
  const mtd = insights.range(projectId, monthStart, date, 'campaign');
  const spentMtd = mtd.reduce((s, r) => s + r.spend, 0);
  const day = Number(date.slice(8, 10));
  const daysInMonth = Number(endOfMonth(date).slice(8, 10));
  const expected = Math.round((project.monthly_budget / daysInMonth) * day);
  const budget = {
    monthly: project.monthly_budget,
    spentMtd,
    expected,
    pacePct: expected > 0 ? ((spentMtd - expected) / expected) * 100 : 0,
    remainingDays: daysInMonth - day,
  };

  // クリエイティブ別
  const adRows = insights.byDate(projectId, date, 'ad');
  const creatives: CreativeRow[] = adRows
    .map((row) => {
      const object = metaObjects.find(row.object_id);
      return {
        name: object?.name ?? row.object_id,
        status: object?.status ?? '—',
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: pct(row.clicks, row.impressions),
        conversions: row.conversions,
        cpa: row.conversions > 0 ? Math.round(row.spend / row.conversions) : 0,
        roas: safeDiv(row.conversion_value, row.spend),
        frequency: row.frequency,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // 運用アクション
  const actions = optimizerActions.byDate(projectId, date).map((a) => ({
    rule: a.rule,
    action: actionLabel(a.action),
    target: a.object_name ?? a.object_id ?? '—',
    reason: a.reason,
    applied: a.applied === 1,
  }));

  // 制作進捗
  const production = orders
    .list({ projectId, limit: 30 })
    .filter((o) => !['completed', 'cancelled'].includes(o.status))
    .map((o) => ({
      title: o.title,
      type: typeLabel(o.type),
      status: STATUS_LABELS[o.status] ?? o.status,
      due: o.due_date,
      auto: o.auto_generated === 1,
    }));

  // 法務
  const legal = legalReviews
    .byProject(projectId, 30)
    .filter((r) => r.created_at.slice(0, 10) >= date)
    .map((r) => ({
      subject: `${subjectLabel(r.subject_type)}`,
      status: r.status,
      score: r.score,
      findings: parseJson<unknown[]>(r.findings, []).length,
    }));

  // アラート
  const alerts: string[] = [];
  if (project.target_cpa > 0 && cur.cpa > project.target_cpa * 1.3 && cur.conversions > 0) {
    alerts.push(`CPAが目標の${Math.round((cur.cpa / project.target_cpa) * 100)}%に達しています（${formatYen(cur.cpa)} / 目標 ${formatYen(project.target_cpa)}）。`);
  }
  if (cur.spend > 0 && cur.conversions === 0) {
    alerts.push(`本日CVが0件です（消化 ${formatYen(cur.spend)}）。計測タグとLPの動作確認を推奨します。`);
  }
  if (budget.pacePct > 20) alerts.push(`予算消化が計画比 +${budget.pacePct.toFixed(0)}%。月末までに予算超過の見込みです。`);
  if (budget.pacePct < -20) alerts.push(`予算消化が計画比 ${budget.pacePct.toFixed(0)}%。配信量が不足しています。`);
  if (cur.frequency > 2.8) alerts.push(`フリークエンシーが${cur.frequency.toFixed(2)}。クリエイティブ疲弊の可能性があります。`);
  for (const l of legal.filter((x) => x.status === 'block')) {
    alerts.push(`法務チェックで差し止め判定があります（${l.subject}／指摘${l.findings}件）。`);
  }

  const model: ReportModel = {
    projectName: project.name,
    advertiserName: advertiser.name,
    date,
    kpis,
    budget,
    creatives,
    actions,
    production,
    legal,
    alerts,
    summary: '',
    nextActions: [],
  };

  const narrative = await writeNarrative(model, project.target_cpa);
  model.summary = narrative.summary;
  model.nextActions = narrative.nextActions;

  const markdown = toMarkdown(model);
  const html = toHtml(model);
  const stored = save(pathFor({ projectId, kind: 'reports', name: `daily_${date}.html` }), html);
  save(pathFor({ projectId, kind: 'reports', name: `daily_${date}.md` }), markdown);

  const report = reports.save({
    project_id: projectId,
    scope: 'project',
    type: 'daily',
    date,
    title: `${project.name} 日次運用レポート ${date}`,
    summary: {
      spend: cur.spend, impressions: cur.impressions, clicks: cur.clicks,
      conversions: cur.conversions, cpa: cur.cpa, roas: Number(cur.roas.toFixed(2)),
      ctr: Number(cur.ctr.toFixed(2)), frequency: Number(cur.frequency.toFixed(2)),
      spentMtd, pacePct: Number(budget.pacePct.toFixed(1)),
      alerts: alerts.length, actions: actions.length, activeCreatives: creatives.length,
    },
    markdown,
    html,
    storage_path: stored.path,
  });

  log.info('日次レポートを生成', { projectId, date, alerts: alerts.length, actions: actions.length });
  return report;
}

/** 数値は渡すだけ。LLM には「解釈と次アクション」だけを書かせる。 */
async function writeNarrative(model: ReportModel, targetCpa: number): Promise<{ summary: string; nextActions: string[] }> {
  const facts = {
    date: model.date,
    kpi: Object.fromEntries(model.kpis.map((k) => [k.label, k.value])),
    targetCpa,
    budget: model.budget,
    topCreatives: model.creatives.slice(0, 3).map((c) => ({ name: c.name, spend: c.spend, cv: c.conversions, cpa: c.cpa, ctr: Number(c.ctr.toFixed(2)) })),
    actions: model.actions.map((a) => `${a.applied ? '実施' : '提案'}:${a.action}(${a.reason})`),
    alerts: model.alerts,
    production: model.production.map((p) => `${p.status}:${p.title}`),
  };

  const prompt = `以下は広告運用の実績データです。この数値のみに基づいて日次レポートの文章を書いてください。
データに無い数値を創作してはいけません。

${JSON.stringify(facts, null, 2)}

# 出力（JSONのみ）
\`\`\`json
{"summary":"3〜4文のサマリー。良かった点・悪かった点・原因の仮説を含める。","nextActions":["明日実行すべき具体的なアクション（3〜5件）"]}
\`\`\``;

  try {
    const { completeJson } = await import('../providers/registry.ts');
    const result = await completeJson<{ summary?: string; nextActions?: string[] }>(
      {
        system: 'あなたは広告運用のアカウントプランナーです。事実に基づき簡潔に報告します。誇張も過度な悲観もしません。',
        prompt, temperature: 0.4, maxTokens: 1200, tag: 'report.daily',
      },
      {},
    );
    if (result.summary) {
      return { summary: result.summary, nextActions: result.nextActions ?? [] };
    }
  } catch (err) {
    log.warn('サマリー生成に失敗。数値ベースの定型文で代替します', { error: String(err) });
  }
  return { summary: fallbackSummary(model, targetCpa), nextActions: fallbackNextActions(model, targetCpa) };
}

function fallbackSummary(model: ReportModel, targetCpa: number): string {
  const spend = model.kpis.find((k) => k.label === '消化金額')?.value ?? '—';
  const cv = model.kpis.find((k) => k.label === 'CV')?.value ?? '0件';
  const cpa = model.kpis.find((k) => k.label === 'CPA')?.value ?? '—';
  const judge = targetCpa > 0 && model.creatives.length
    ? `目標CPA ${formatYen(targetCpa)} に対する着地は ${cpa} です。`
    : '目標CPAが未設定のため、絶対評価は行っていません。';
  return `本日の消化は ${spend}、コンバージョンは ${cv}、CPAは ${cpa} でした。${judge}` +
    `配信中クリエイティブは ${model.creatives.length} 本、自動運用アクションは ${model.actions.length} 件を記録しています。` +
    (model.alerts.length ? `未解消のアラートが ${model.alerts.length} 件あります。` : 'アラートはありません。');
}

function fallbackNextActions(model: ReportModel, targetCpa: number): string[] {
  const actions: string[] = [];
  if (model.creatives.length < 3) actions.push('検証本数を確保するため、新規クリエイティブを追加投入する');
  const worst = model.creatives.filter((c) => targetCpa > 0 && c.cpa > targetCpa * 1.5);
  if (worst.length) actions.push(`CPA超過のクリエイティブ（${worst.map((c) => c.name).join('、')}）を停止または予算縮小する`);
  const best = model.creatives.filter((c) => targetCpa > 0 && c.cpa > 0 && c.cpa <= targetCpa * 0.8);
  if (best.length) actions.push(`好調なクリエイティブ（${best.map((c) => c.name).join('、')}）の予算を段階的に増額する`);
  if (model.budget.pacePct > 20) actions.push('月予算超過を避けるため日予算を調整する');
  if (model.budget.pacePct < -20) actions.push('配信量不足を解消するためターゲティングを拡張する');
  if (actions.length === 0) actions.push('現状の配信を継続し、CPAとフリークエンシーの推移を監視する');
  return actions;
}

const actionLabels: Record<string, string> = {
  pause: '広告を停止',
  scale_budget: '予算を増額',
  reduce_budget: '予算を減額',
  duplicate: '広告セットを複製',
  request_creative: 'クリエイティブを自動発注',
  alert: 'アラート通知',
};
const actionLabel = (action: string): string => actionLabels[action] ?? action;

const typeLabels: Record<string, string> = {
  video_ad: '動画広告', article_lp: '記事LP', lp: 'LP', meta_operation: 'Meta運用',
};
const typeLabel = (type: string): string => typeLabels[type] ?? type;

const subjectLabels: Record<string, string> = {
  script: '動画台本', article_lp: '記事LP', lp: 'LP', ad_copy: '広告文', deliverable: '納品物', storyboard: '絵コンテ',
};
const subjectLabel = (type: string): string => subjectLabels[type] ?? type;

/** 全案件を横断した代理店向けサマリー */
export async function generateAgencyReport(date = jstDateString(new Date(Date.now() - 86_400_000))): Promise<Report> {
  const list = projects.active();
  const rows = list.map((project) => {
    const m = aggregate(insights.byDate(project.id, date, 'campaign'));
    return {
      projectId: project.id,
      name: project.name,
      spend: m.spend,
      conversions: m.conversions,
      cpa: m.cpa,
      targetCpa: project.target_cpa,
      roas: Number(m.roas.toFixed(2)),
      status: project.target_cpa > 0 && m.cpa > 0 && m.cpa > project.target_cpa * 1.2 ? 'alert' : 'ok',
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ spend: acc.spend + r.spend, conversions: acc.conversions + r.conversions }),
    { spend: 0, conversions: 0 },
  );

  const markdown = `# 全案件サマリー ${date}

| 案件 | 消化 | CV | CPA | 目標CPA | ROAS | 状態 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${rows.map((r) => `| ${r.name} | ${formatYen(r.spend)} | ${r.conversions} | ${r.cpa ? formatYen(r.cpa) : '—'} | ${r.targetCpa ? formatYen(r.targetCpa) : '—'} | ${r.roas} | ${r.status === 'ok' ? '✅' : '⚠️'} |`).join('\n')}

**合計**: 消化 ${formatYen(totals.spend)} ／ CV ${totals.conversions}件 ／ 全体CPA ${totals.conversions ? formatYen(Math.round(totals.spend / totals.conversions)) : '—'}
`;

  return reports.save({
    project_id: null,
    scope: 'agency',
    type: 'daily',
    date,
    title: `全案件サマリー ${date}`,
    summary: { projects: rows.length, ...totals, alerts: rows.filter((r) => r.status === 'alert').length },
    markdown,
  });
}
