import { config } from '../config/env.ts';
import { invoices, ledger } from '../db/repositories/finance.ts';
import { orgs } from '../db/repositories/orgs.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { insights } from '../db/repositories/meta.ts';
import { events } from '../db/repositories/system.ts';
import { parseJson } from '../db/sqlite.ts';
import { addDays, endOfMonth, formatJp, jstDateString } from '../lib/date.ts';
import { formatYen, summarizeTax, withholdingTax, type TaxRate } from '../lib/money.ts';
import { escapeHtml } from '../lib/text.ts';
import { pathFor, save } from '../providers/storage/local.ts';
import type { Invoice, InvoiceLine } from '../domain/types.ts';

/**
 * 請求書 / 支払通知書の自動生成。
 *
 * ASP の三層それぞれで金額が違うため、direction で書き分ける:
 *   receivable … 自社（メディア）→ 代理店 への請求書
 *   payable    … 代理店 → メディア への支払通知書（買い手側が作る仕入明細書）
 *
 * 消費税はインボイス制度に従い「税率ごとに1回だけ」端数処理する（summarizeTax）。
 * 受注者が個人（is_individual=1）の場合は源泉徴収税を自動控除する。
 */

export type BuildInvoiceInput = {
  projectId: string;
  direction: 'receivable' | 'payable';
  periodFrom: string;
  periodTo: string;
  issueDate?: string;
  /** 明細を明示指定する場合。省略時は案件の実績から自動生成 */
  lines?: InvoiceLine[];
  taxRate?: TaxRate;
  notes?: string;
};

/** 案件の期間実績から請求明細を組み立てる */
export function buildLinesFromPerformance(
  projectId: string,
  periodFrom: string,
  periodTo: string,
  direction: 'receivable' | 'payable',
  taxRate: TaxRate = 10,
): InvoiceLine[] {
  const project = projects.require(projectId);
  const lines: InvoiceLine[] = [];

  // 1) 成果報酬（CPA / レベニューシェア）
  const rows = insights.range(projectId, periodFrom, periodTo, 'campaign');
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const spend = rows.reduce((s, r) => s + r.spend, 0);

  if (project.revenue_model === 'cpa' && conversions > 0) {
    const unit = direction === 'receivable' ? project.media_unit_price : project.media_unit_price;
    const clientUnit = project.client_unit_price;
    const price = direction === 'receivable' ? unit : clientUnit;
    lines.push({
      description: `成果報酬（${formatJp(periodFrom)}〜${formatJp(periodTo)}）`,
      quantity: conversions,
      unitPrice: price,
      amount: conversions * price,
      taxRate,
      note: `承認CV ${conversions}件`,
    });
  } else if (project.revenue_model === 'revshare' && spend > 0) {
    const rate = direction === 'receivable' ? 1 - project.agency_margin_rate : 1;
    const amount = Math.floor(spend * rate);
    lines.push({
      description: `運用手数料（広告費 ${formatYen(spend)} × ${Math.round(rate * 100)}%）`,
      quantity: 1,
      unitPrice: amount,
      amount,
      taxRate,
      note: `広告費実績 ${formatYen(spend)}`,
    });
  }

  // 2) 制作費（納品済みの発注）
  const delivered = orders.list({ projectId }).filter(
    (o) => ['delivered', 'live', 'completed'].includes(o.status)
      && o.updated_at.slice(0, 10) >= periodFrom && o.updated_at.slice(0, 10) <= periodTo,
  );
  const typeLabels: Record<string, string> = {
    video_ad: '動画広告制作',
    article_lp: '記事LP制作',
    lp: 'LP制作',
    meta_operation: 'Meta広告運用',
  };
  for (const order of delivered) {
    const amount = direction === 'receivable' ? order.media_amount : order.client_amount;
    if (amount <= 0) continue;
    lines.push({
      description: `${typeLabels[order.type] ?? order.type}：${order.title}`,
      quantity: order.quantity,
      unitPrice: Math.floor(amount / Math.max(1, order.quantity)),
      amount,
      taxRate,
      note: order.id,
    });
  }

  // 3) 広告費実費（代理店が立て替えている場合の請求）
  if (direction === 'payable' && spend > 0 && project.revenue_model !== 'revshare') {
    lines.push({
      description: `Meta広告費 実費（${formatJp(periodFrom)}〜${formatJp(periodTo)}）`,
      quantity: 1,
      unitPrice: spend,
      amount: spend,
      taxRate,
      note: '媒体費実費',
    });
  }

  return lines;
}

export function buildInvoice(input: BuildInvoiceInput): Invoice {
  const project = projects.require(input.projectId);
  const taxRate = input.taxRate ?? 10;
  const issueDate = input.issueDate ?? jstDateString();

  // receivable: メディア → 代理店 / payable: 代理店 → メディア
  const issuerOrgId = input.direction === 'receivable' ? project.media_org_id : project.agency_org_id;
  const billToOrgId = input.direction === 'receivable' ? project.agency_org_id : project.media_org_id;
  const issuer = orgs.require(issuerOrgId);
  const billTo = orgs.require(billToOrgId);

  const lines = input.lines?.length
    ? input.lines
    : buildLinesFromPerformance(project.id, input.periodFrom, input.periodTo, input.direction, taxRate);

  const summary = summarizeTax(lines.map((l) => ({ amount: l.amount, taxRate: l.taxRate })), 'floor');

  // 源泉徴収は「受注者が個人」かつ報酬・料金に該当する場合のみ。税抜額を課税標準とする。
  const recipient = input.direction === 'receivable' ? issuer : billTo;
  const withholding = recipient.is_individual === 1 ? withholdingTax(summary.subtotal) : 0;
  const payable = summary.total - withholding;

  const prefix = `${issueDate.slice(0, 7).replace('-', '')}`;
  const invoiceNo = invoices.nextNumber(input.direction === 'receivable' ? `INV-${prefix}` : `PAY-${prefix}`);

  const dueDate = issuer.payment_terms.includes('翌月')
    ? endOfMonth(addDays(endOfMonth(issueDate), 1))
    : addDays(issueDate, 30);

  const invoice = invoices.create({
    invoice_no: invoiceNo,
    direction: input.direction,
    project_id: project.id,
    issuer_org_id: issuerOrgId,
    bill_to_org_id: billToOrgId,
    issue_date: issueDate,
    due_date: dueDate,
    period_from: input.periodFrom,
    period_to: input.periodTo,
    lines: JSON.stringify(lines),
    subtotal: summary.subtotal,
    tax: summary.tax,
    total: summary.total,
    withholding,
    payable,
    status: 'draft',
  });

  const html = invoiceHtml(invoice, lines, summary, input.notes);
  const stored = save(
    pathFor({ projectId: project.id, kind: 'invoices', name: `${invoiceNo}.html` }),
    html,
  );
  invoices.update(invoice.id, { html, storage_path: stored.path });

  events.log('system', 'invoice.generated', 'invoice', invoice.id, {
    invoiceNo, direction: input.direction, total: summary.total, payable,
  });

  return invoices.require(invoice.id);
}

/** 発行（確定）。同時に台帳へ計上する。 */
export function issueInvoice(invoiceId: string): Invoice {
  const invoice = invoices.require(invoiceId);
  if (invoice.status !== 'draft') return invoice;
  invoices.update(invoiceId, { status: 'issued' });

  if (invoice.project_id) {
    ledger.add({
      project_id: invoice.project_id,
      date: invoice.issue_date,
      kind: invoice.direction === 'receivable' ? 'client_revenue' : 'media_cost',
      counterparty_org_id: invoice.bill_to_org_id,
      amount: invoice.direction === 'receivable' ? invoice.total : -invoice.total,
      memo: `${invoice.invoice_no}`,
      ref_type: 'invoice',
      ref_id: invoice.id,
    });
  }
  events.log('system', 'invoice.issued', 'invoice', invoiceId);
  return invoices.require(invoiceId);
}

export function markPaid(invoiceId: string, paidAt?: string): Invoice {
  invoices.update(invoiceId, { status: 'paid', paid_at: paidAt ?? jstDateString() });
  events.log('system', 'invoice.paid', 'invoice', invoiceId);
  return invoices.require(invoiceId);
}

export function invoiceHtml(
  invoice: Invoice,
  lines: InvoiceLine[],
  summary: ReturnType<typeof summarizeTax>,
  notes?: string,
): string {
  const issuer = orgs.require(invoice.issuer_org_id);
  const billTo = orgs.require(invoice.bill_to_org_id);
  const isReceivable = invoice.direction === 'receivable';
  const docTitle = isReceivable ? '請求書' : '支払通知書';

  const rows = lines
    .map(
      (l) => `<tr>
      <td>${escapeHtml(l.description)}${l.note ? `<br><span class="muted">${escapeHtml(l.note)}</span>` : ''}</td>
      <td class="num">${l.quantity.toLocaleString('ja-JP')}</td>
      <td class="num">${formatYen(l.unitPrice)}</td>
      <td class="num">${l.taxRate}%</td>
      <td class="num">${formatYen(l.amount)}</td>
    </tr>`,
    )
    .join('');

  const taxRows = summary.byRate
    .map(
      (b) => `<tr><th>${b.taxRate}%対象</th><td class="num">${formatYen(b.taxable)}</td>
              <th>消費税(${b.taxRate}%)</th><td class="num">${formatYen(b.tax)}</td></tr>`,
    )
    .join('');

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${docTitle} ${invoice.invoice_no}</title>
<style>
 body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;max-width:820px;margin:32px auto;padding:0 24px;color:#111}
 h1{text-align:center;letter-spacing:.6em;font-size:26px;margin-bottom:28px;border-bottom:3px double #222;padding-bottom:14px}
 .meta{display:flex;justify-content:space-between;gap:32px;margin-bottom:24px;font-size:14px}
 .to{font-size:18px;font-weight:700;border-bottom:1px solid #222;padding-bottom:6px;margin-bottom:12px}
 .total-box{background:#f3f4f6;border:2px solid #222;padding:14px 20px;font-size:22px;font-weight:700;margin:20px 0;display:flex;justify-content:space-between}
 table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
 th,td{border:1px solid #999;padding:8px 10px}
 thead th{background:#eef2f7}
 .num{text-align:right;font-variant-numeric:tabular-nums}
 .muted{color:#666;font-size:11px}
 .summary th{background:#f8fafc;width:22%}
 .note{font-size:12px;color:#444;margin-top:20px;line-height:1.8}
 .seal{float:right;border:2px solid #c00;color:#c00;width:64px;height:64px;border-radius:50%;
       display:flex;align-items:center;justify-content:center;font-size:11px;text-align:center;line-height:1.2}
</style></head><body>
<h1>${docTitle}</h1>
<div class="meta">
  <div style="flex:1">
    <div class="to">${escapeHtml(billTo.legal_name ?? billTo.name)}　御中</div>
    <div>${escapeHtml(billTo.address ?? '')}</div>
    <p style="margin-top:18px">下記のとおり${isReceivable ? 'ご請求' : 'お支払い'}申し上げます。</p>
  </div>
  <div style="flex:1;text-align:right">
    ${issuer.invoice_no ? `<div class="seal">${escapeHtml(config.company.sealText || '印')}</div>` : ''}
    <div><strong>${escapeHtml(issuer.legal_name ?? issuer.name)}</strong></div>
    <div>${escapeHtml(issuer.address ?? '')}</div>
    <div>TEL: ${escapeHtml(issuer.tel ?? '')}</div>
    <div>登録番号: ${escapeHtml(issuer.invoice_no ?? '（未登録）')}</div>
    <div style="margin-top:10px">${docTitle}番号: ${invoice.invoice_no}</div>
    <div>発行日: ${formatJp(invoice.issue_date)}</div>
    <div>支払期限: ${formatJp(invoice.due_date)}</div>
  </div>
</div>

<div class="total-box"><span>${isReceivable ? 'ご請求金額' : 'お支払金額'}（税込）</span><span>${formatYen(invoice.payable)}</span></div>

<table>
  <thead><tr><th style="width:46%">摘要</th><th class="num">数量</th><th class="num">単価</th><th class="num">税率</th><th class="num">金額</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5">対象期間の明細はありません</td></tr>'}</tbody>
</table>

<table class="summary">
  ${taxRows}
  <tr><th>小計（税抜）</th><td class="num">${formatYen(summary.subtotal)}</td><th>消費税合計</th><td class="num">${formatYen(summary.tax)}</td></tr>
  <tr><th>合計（税込）</th><td class="num">${formatYen(summary.total)}</td>
      <th>源泉徴収税</th><td class="num">${invoice.withholding ? `▲ ${formatYen(invoice.withholding)}` : '—'}</td></tr>
  <tr><th>差引${isReceivable ? 'ご請求' : 'お支払'}額</th><td class="num" colspan="3"><strong>${formatYen(invoice.payable)}</strong></td></tr>
</table>

<div class="note">
  <div>対象期間: ${invoice.period_from ? formatJp(invoice.period_from) : '—'} 〜 ${invoice.period_to ? formatJp(invoice.period_to) : '—'}</div>
  <div>お振込先: ${escapeHtml(config.company.bank || '（別途ご連絡）')}</div>
  ${invoice.withholding ? '<div>※ 源泉徴収税額は所得税法第204条第1項に基づき控除しています。</div>' : ''}
  <div>※ 本書は適格請求書等保存方式（インボイス制度）の記載事項に対応しています。</div>
  ${notes ? `<div>${escapeHtml(notes)}</div>` : ''}
</div>
</body></html>`;
}

export function invoiceLines(invoice: Invoice): InvoiceLine[] {
  return parseJson<InvoiceLine[]>(invoice.lines, []);
}
