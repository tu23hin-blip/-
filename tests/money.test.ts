import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTax, withholdingTax, roundYen } from '../src/lib/money.ts';

describe('金額・税計算', () => {
  test('税率ごとに1回だけ端数処理する（インボイス制度の要件）', () => {
    // 個別に切り捨てると 3 + 3 = 6 円になるが、合算後に1回処理すると 7 円
    const summary = summarizeTax([
      { amount: 33, taxRate: 10 },
      { amount: 38, taxRate: 10 },
    ]);
    assert.equal(summary.subtotal, 71);
    assert.equal(summary.tax, 7);
    assert.equal(summary.total, 78);
  });

  test('複数税率を税率ごとに分けて集計する', () => {
    const summary = summarizeTax([
      { amount: 10_000, taxRate: 10 },
      { amount: 5_000, taxRate: 8 },
      { amount: 3_000, taxRate: 10 },
    ]);
    assert.equal(summary.byRate.length, 2);
    assert.deepEqual(summary.byRate[0], { taxRate: 10, taxable: 13_000, tax: 1_300 });
    assert.deepEqual(summary.byRate[1], { taxRate: 8, taxable: 5_000, tax: 400 });
    assert.equal(summary.total, 19_700);
  });

  test('源泉徴収税は100万円以下 10.21%', () => {
    assert.equal(withholdingTax(100_000), 10_210);
    assert.equal(withholdingTax(1_000_000), 102_100);
  });

  test('源泉徴収税は100万円超の部分が 20.42%', () => {
    // 1,000,000×10.21% + 200,000×20.42% = 102,100 + 40,840
    assert.equal(withholdingTax(1_200_000), 142_940);
  });

  test('丸めモードが指定どおりに効く', () => {
    assert.equal(roundYen(10.9, 'floor'), 10);
    assert.equal(roundYen(10.1, 'ceil'), 11);
    assert.equal(roundYen(10.5, 'round'), 11);
  });
});
