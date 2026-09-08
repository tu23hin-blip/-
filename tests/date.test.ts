import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, endOfMonth, jstDateString, jstDayRange, formatJp } from '../src/lib/date.ts';

describe('JST基準の日付処理', () => {
  test('UTC深夜でも JST の日付になる', () => {
    // 2026-09-08T16:00:00Z は JST では 2026-09-09
    assert.equal(jstDateString(new Date('2026-09-08T16:00:00Z')), '2026-09-09');
    assert.equal(jstDateString(new Date('2026-09-08T14:59:00Z')), '2026-09-08');
  });

  test('JST の1日の範囲が UTC で正しく切られる', () => {
    const range = jstDayRange('2026-09-08');
    assert.equal(range.startIso, '2026-09-07T15:00:00.000Z');
    assert.equal(range.endIso, '2026-09-08T14:59:59.999Z');
  });

  test('月またぎの加減算', () => {
    assert.equal(addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });

  test('うるう年の月末', () => {
    assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
    assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  });

  test('日数差', () => {
    assert.equal(daysBetween('2026-09-01', '2026-09-08'), 7);
    assert.equal(daysBetween('2026-09-08', '2026-09-01'), -7);
  });

  test('和暦形式の整形', () => {
    assert.equal(formatJp('2026-09-08'), '2026年9月8日');
  });
});
