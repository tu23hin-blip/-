/**
 * 金額は「円・整数」で扱う。浮動小数の丸め誤差を業務データに持ち込まない。
 * 消費税はインボイス制度に従い「税率ごとに1回だけ」端数処理する。
 */
export type TaxRate = 10 | 8 | 0;
export type RoundingMode = 'floor' | 'ceil' | 'round';

export function roundYen(value: number, mode: RoundingMode = 'floor'): number {
  if (mode === 'ceil') return Math.ceil(value - 1e-9);
  if (mode === 'round') return Math.round(value);
  return Math.floor(value + 1e-9);
}

export type TaxLine = { amount: number; taxRate: TaxRate };
export type TaxSummary = {
  byRate: { taxRate: TaxRate; taxable: number; tax: number }[];
  subtotal: number;
  tax: number;
  total: number;
};

/** 税率ごとに合算 → 税率ごとに1回端数処理（適格請求書の要件） */
export function summarizeTax(lines: TaxLine[], mode: RoundingMode = 'floor'): TaxSummary {
  const buckets = new Map<TaxRate, number>();
  for (const line of lines) {
    buckets.set(line.taxRate, (buckets.get(line.taxRate) ?? 0) + line.amount);
  }
  const byRate = [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([taxRate, taxable]) => ({
      taxRate,
      taxable: roundYen(taxable, mode),
      tax: roundYen((taxable * taxRate) / 100, mode),
    }));
  const subtotal = byRate.reduce((s, b) => s + b.taxable, 0);
  const tax = byRate.reduce((s, b) => s + b.tax, 0);
  return { byRate, subtotal, tax, total: subtotal + tax };
}

/**
 * 源泉徴収税（報酬・料金）。個人事業主への支払いのみ対象。
 * 100万円以下: 10.21% / 超過分: 20.42%
 */
export function withholdingTax(taxableAmount: number): number {
  if (taxableAmount <= 1_000_000) return roundYen(taxableAmount * 0.1021, 'floor');
  return roundYen(1_000_000 * 0.1021 + (taxableAmount - 1_000_000) * 0.2042, 'floor');
}

export function formatYen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

export function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function pct(a: number, b: number): number {
  return b === 0 ? 0 : (a / b) * 100;
}
