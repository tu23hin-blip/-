import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS, canTransition, STATUS_LABELS } from '../src/domain/workflow.ts';
import type { OrderStatus } from '../src/domain/types.ts';

describe('受注ワークフロー', () => {
  test('正常な遷移を許可する', () => {
    assert.ok(canTransition('requested', 'accepted'));
    assert.ok(canTransition('accepted', 'in_production'));
    assert.ok(canTransition('legal_review', 'approved'));
    assert.ok(canTransition('approved', 'delivered'));
    assert.ok(canTransition('delivered', 'live'));
  });

  test('工程を飛ばす遷移を拒否する', () => {
    assert.ok(!canTransition('requested', 'delivered'));
    assert.ok(!canTransition('in_production', 'approved'));
    assert.ok(!canTransition('completed', 'in_production'));
  });

  test('終端状態からは遷移できない', () => {
    assert.deepEqual(TRANSITIONS.completed, []);
    assert.deepEqual(TRANSITIONS.cancelled, []);
  });

  test('全ステータスに日本語ラベルがある', () => {
    for (const status of Object.keys(TRANSITIONS) as OrderStatus[]) {
      assert.ok(STATUS_LABELS[status], `${status} のラベルがありません`);
    }
  });

  test('遷移先はすべて既知のステータスである', () => {
    const known = new Set(Object.keys(TRANSITIONS));
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        assert.ok(known.has(to), `${from} → ${to} の遷移先が未定義です`);
      }
    }
  });
});
