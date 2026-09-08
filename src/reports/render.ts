import { escapeHtml } from '../lib/text.ts';
import { formatJp } from '../lib/date.ts';
import { formatYen } from '../lib/money.ts';

/** 日次報告書の描画。Markdown（保存・検索用）と HTML（配布用）の2形式を作る。 */

export type Kpi = {
  label: string;
  value: string;
  delta?: number | null;      // 前日比（%）
  target?: string | null;
  status?: 'good' | 'warn' | 'bad' | 'neutral';
};

export type CreativeRow = {
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cpa: number;
  roas: number;
  frequency: number;
};

export type ActionRow = { rule: string; action: string; target: string; reason: string; applied: boolean };
export type ProductionRow = { title: string; type: string; status: string; due: string | null; auto: boolean };
export type LegalRow = { subject: string; status: string; score: number; findings: number };

export type ReportModel = {
  projectName: string;
  advertiserName: string;
  date: string;
  kpis: Kpi[];
  budget: { monthly: number; spentMtd: number; expected: number; pacePct: number; remainingDays: number };
  creatives: CreativeRow[];
  actions: ActionRow[];
  production: ProductionRow[];
  legal: LegalRow[];
  alerts: string[];
  summary: string;
  nextActions: string[];
};

export function toMarkdown(m: ReportModel): string {
  const kpiTable = [
    '| 指標 | 実績 | 前日比 | 目標 |',
    '| --- | ---: | ---: | ---: |',
    ...m.kpis.map(
      (k) => `| ${k.label} | ${k.value} | ${k.delta === null || k.delta === undefined ? '—' : `${k.delta >= 0 ? '+' : ''}${k.delta.toFixed(1)}%`} | ${k.target ?? '—'} |`,
    ),
  ].join('\n');

  const creativeTable = m.creatives.length
    ? [
        '| クリエイティブ | 状態 | 消化 | IMP | CTR | CV | CPA | ROAS | FRQ |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...m.creatives.map(
          (c) => `| ${c.name} | ${c.status} | ${formatYen(c.spend)} | ${c.impressions.toLocaleString()} | ${c.ctr.toFixed(2)}% | ${c.conversions} | ${c.cpa ? formatYen(c.cpa) : '—'} | ${c.roas.toFixed(2)} | ${c.frequency.toFixed(2)} |`,
        ),
      ].join('\n')
    : '_配信中のクリエイティブがありません_';

  return `# ${m.projectName} 日次運用レポート

**${formatJp(m.date)}**　／　広告主: ${m.advertiserName}

## 1. サマリー
${m.summary}

## 2. KPI
${kpiTable}

## 3. 予算消化
- 月予算: ${formatYen(m.budget.monthly)}
- 当月消化: ${formatYen(m.budget.spentMtd)}（計画比 ${m.budget.pacePct >= 0 ? '+' : ''}${m.budget.pacePct.toFixed(1)}%）
- 想定消化: ${formatYen(m.budget.expected)}
- 残日数: ${m.budget.remainingDays}日

## 4. クリエイティブ別実績
${creativeTable}

## 5. 実施した運用アクション
${m.actions.length ? m.actions.map((a) => `- ${a.applied ? '✅ 実施' : '📝 提案'} **${a.action}** / ${a.target}\n  - ${a.reason}`).join('\n') : '- 本日の自動アクションはありません'}

## 6. 制作進捗
${m.production.length ? m.production.map((p) => `- [${p.status}] ${p.title}（${p.type}）${p.auto ? ' ※自動発注' : ''}${p.due ? ` / 納期 ${p.due}` : ''}`).join('\n') : '- 進行中の制作はありません'}

## 7. 法務チェック
${m.legal.length ? m.legal.map((l) => `- ${statusMark(l.status)} ${l.subject}（スコア ${l.score} / 指摘 ${l.findings}件）`).join('\n') : '- 本日の審査対象はありません'}

## 8. アラート
${m.alerts.length ? m.alerts.map((a) => `- ⚠️ ${a}`).join('\n') : '- なし'}

## 9. 明日のアクション
${m.nextActions.length ? m.nextActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '1. 現状の配信を継続し、CPAの推移を監視'}

---
_本レポートは運用自動化システムにより生成されました。_
`;
}

function statusMark(status: string): string {
  return status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '⛔';
}

export function toHtml(m: ReportModel): string {
  const kpiCards = m.kpis
    .map(
      (k) => `<div class="card ${k.status ?? 'neutral'}">
      <div class="label">${escapeHtml(k.label)}</div>
      <div class="value">${escapeHtml(k.value)}</div>
      <div class="sub">${k.delta === null || k.delta === undefined ? '&nbsp;' : `<span class="${k.delta >= 0 ? 'up' : 'down'}">${k.delta >= 0 ? '▲' : '▼'} ${Math.abs(k.delta).toFixed(1)}%</span> 前日比`}
      ${k.target ? `<span class="target">目標 ${escapeHtml(k.target)}</span>` : ''}</div>
    </div>`,
    )
    .join('');

  const pace = Math.max(0, Math.min(200, m.budget.expected ? (m.budget.spentMtd / m.budget.expected) * 100 : 0));

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(m.projectName)} 日次レポート ${m.date}</title>
<style>
 :root{--bg:#f6f7f9;--panel:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;
       --good:#059669;--warn:#d97706;--bad:#dc2626;--accent:#2563eb}
 @media (prefers-color-scheme:dark){:root{--bg:#0b1120;--panel:#111827;--fg:#e5e7eb;--muted:#9ca3af;--line:#1f2937}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);
      font-family:system-ui,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;line-height:1.7}
 .wrap{max-width:960px;margin:0 auto;padding:28px 20px 60px}
 header h1{font-size:22px;margin:0 0 4px}
 header .meta{color:var(--muted);font-size:13px;margin-bottom:24px}
 section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}
 h2{font-size:15px;margin:0 0 14px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
 .card{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px}
 .card .label{font-size:12px;color:var(--muted)}
 .card .value{font-size:24px;font-weight:700;margin:4px 0;font-variant-numeric:tabular-nums}
 .card .sub{font-size:11px;color:var(--muted)}
 .card.good .value{color:var(--good)} .card.warn .value{color:var(--warn)} .card.bad .value{color:var(--bad)}
 .up{color:var(--good)} .down{color:var(--bad)}
 .target{margin-left:8px;padding:1px 6px;background:var(--line);border-radius:4px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th,td{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left}
 th{color:var(--muted);font-size:11px;font-weight:600}
 td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
 .bar{height:10px;background:var(--line);border-radius:99px;overflow:hidden;margin:10px 0 6px}
 .bar span{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#7c3aed)}
 .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;background:var(--line)}
 .pill.applied{background:rgba(5,150,105,.16);color:var(--good)}
 .pill.suggest{background:rgba(217,119,6,.16);color:var(--warn)}
 ul.plain{list-style:none;padding:0;margin:0}
 ul.plain li{padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
 ul.plain li:last-child{border-bottom:none}
 .reason{color:var(--muted);font-size:12px;display:block;margin-top:3px}
 .alert{background:rgba(220,38,38,.1);border-left:3px solid var(--bad);padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}
 .summary{font-size:15px;background:var(--bg);border-left:3px solid var(--accent);padding:14px 16px;border-radius:0 8px 8px 0}
 ol.next{padding-left:20px} ol.next li{margin-bottom:6px;font-size:14px}
 footer{color:var(--muted);font-size:11px;text-align:center;margin-top:24px}
</style></head><body><div class="wrap">
<header>
  <h1>${escapeHtml(m.projectName)}　日次運用レポート</h1>
  <div class="meta">${formatJp(m.date)}　／　広告主: ${escapeHtml(m.advertiserName)}</div>
</header>

<section><h2>サマリー</h2><div class="summary">${escapeHtml(m.summary)}</div></section>

<section><h2>KPI</h2><div class="cards">${kpiCards}</div></section>

<section><h2>予算消化</h2>
  <div class="bar"><span style="width:${pace}%"></span></div>
  <div style="font-size:13px;color:var(--muted)">
    当月消化 <b style="color:var(--fg)">${formatYen(m.budget.spentMtd)}</b> / 月予算 ${formatYen(m.budget.monthly)}
    （計画比 ${m.budget.pacePct >= 0 ? '+' : ''}${m.budget.pacePct.toFixed(1)}%、残り${m.budget.remainingDays}日）
  </div>
</section>

<section><h2>クリエイティブ別実績</h2>
${m.creatives.length ? `<table><thead><tr>
  <th>クリエイティブ</th><th>状態</th><th class="num">消化</th><th class="num">IMP</th>
  <th class="num">CTR</th><th class="num">CV</th><th class="num">CPA</th><th class="num">ROAS</th><th class="num">FRQ</th>
</tr></thead><tbody>${m.creatives
    .map(
      (c) => `<tr><td>${escapeHtml(c.name)}</td><td><span class="pill">${escapeHtml(c.status)}</span></td>
      <td class="num">${formatYen(c.spend)}</td><td class="num">${c.impressions.toLocaleString()}</td>
      <td class="num">${c.ctr.toFixed(2)}%</td><td class="num">${c.conversions}</td>
      <td class="num">${c.cpa ? formatYen(c.cpa) : '—'}</td><td class="num">${c.roas.toFixed(2)}</td>
      <td class="num">${c.frequency.toFixed(2)}</td></tr>`,
    )
    .join('')}</tbody></table>` : '<div style="color:var(--muted);font-size:13px">配信中のクリエイティブがありません</div>'}
</section>

<section><h2>実施した運用アクション</h2>
${m.actions.length ? `<ul class="plain">${m.actions
    .map(
      (a) => `<li><span class="pill ${a.applied ? 'applied' : 'suggest'}">${a.applied ? '実施' : '提案'}</span>
      <b>${escapeHtml(a.action)}</b> — ${escapeHtml(a.target)}
      <span class="reason">${escapeHtml(a.reason)}</span></li>`,
    )
    .join('')}</ul>` : '<div style="color:var(--muted);font-size:13px">本日の自動アクションはありません</div>'}
</section>

<section><h2>制作進捗</h2>
${m.production.length ? `<ul class="plain">${m.production
    .map(
      (p) => `<li><span class="pill">${escapeHtml(p.status)}</span> ${escapeHtml(p.title)}
      <span class="reason">${escapeHtml(p.type)}${p.auto ? '／自動発注' : ''}${p.due ? `／納期 ${p.due}` : ''}</span></li>`,
    )
    .join('')}</ul>` : '<div style="color:var(--muted);font-size:13px">進行中の制作はありません</div>'}
</section>

<section><h2>法務チェック</h2>
${m.legal.length ? `<ul class="plain">${m.legal
    .map(
      (l) => `<li>${statusMark(l.status)} ${escapeHtml(l.subject)}
      <span class="reason">スコア ${l.score} ／ 指摘 ${l.findings}件</span></li>`,
    )
    .join('')}</ul>` : '<div style="color:var(--muted);font-size:13px">本日の審査対象はありません</div>'}
</section>

${m.alerts.length ? `<section><h2>アラート</h2>${m.alerts.map((a) => `<div class="alert">${escapeHtml(a)}</div>`).join('')}</section>` : ''}

<section><h2>明日のアクション</h2>
  <ol class="next">${(m.nextActions.length ? m.nextActions : ['現状の配信を継続し、CPAの推移を監視']).map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ol>
</section>

<footer>本レポートは運用自動化システムにより ${new Date().toISOString()} に生成されました。</footer>
</div></body></html>`;
}
