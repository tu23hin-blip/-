import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scan, grade } from '../src/legal/scanner.ts';
import { DICTIONARY, appliesTo } from '../src/legal/dictionary.ts';

describe('薬機法・景表法スキャナ', () => {
  test('化粧品で「シミが消える」を block として検出する', () => {
    const findings = scan('使い続けるとシミが消えると評判です', { category: 'cosmetics', useDbRules: false });
    const hit = findings.find((f) => f.ruleId === 'yk-cos-01');
    assert.ok(hit, '検出されるべき');
    assert.equal(hit.severity, 'block');
    assert.equal(hit.law, 'yakkihou');
  });

  test('記号や空白を挟んだ分断表現も検出する（すり抜け対策）', () => {
    const findings = scan('シ・ミ が 消 え る！', { category: 'cosmetics', useDbRules: false });
    assert.ok(findings.some((f) => f.ruleId === 'yk-cos-01'));
  });

  test('全角英数字を含む No.1 表現を検出する', () => {
    const findings = scan('顧客満足度ＮＯ１の実績', { category: 'general', useDbRules: false });
    assert.ok(findings.some((f) => f.law === 'yakkihou' || f.law === 'keihyo'));
  });

  test('カテゴリによって可否が変わる（育毛は化粧品NG／医薬部外品OK）', () => {
    const cosmetic = scan('しっかり育毛できます', { category: 'cosmetics', useDbRules: false });
    const quasi = scan('しっかり育毛できます', { category: 'quasi_drug', useDbRules: false });
    assert.ok(cosmetic.some((f) => f.ruleId === 'yk-cos-05'));
    assert.ok(!quasi.some((f) => f.ruleId === 'yk-cos-05'));
  });

  test('サプリの「痩せる」は block、一般カテゴリでは対象外', () => {
    assert.ok(scan('飲むだけで痩せる', { category: 'supplement', useDbRules: false }).some((f) => f.severity === 'block'));
    assert.ok(!scan('飲むだけで痩せる', { category: 'general', useDbRules: false }).some((f) => f.ruleId === 'yk-sup-01'));
  });

  test('パーセント記号を含む断定表現を検出する（%は正規化で落とさない）', () => {
    const findings = scan('効果は100%保証します', { category: 'general', useDbRules: false });
    const hit = findings.find((f) => f.ruleId === 'kh-01');
    assert.ok(hit, '「100%」が検出されるべき');
    assert.equal(hit.severity, 'block');
    assert.equal(hit.phrase, '100%');
  });

  test('検出された phrase が原文の該当箇所そのものである', () => {
    const findings = scan('この美容液ならシミが消えると評判', { category: 'cosmetics', useDbRules: false });
    const hit = findings.find((f) => f.ruleId === 'yk-cos-01');
    assert.equal(hit?.phrase, 'シミが消える');
    assert.ok(hit?.context.includes('シミが消える'));
  });

  test('大文字を含むパターンも照合できる（No.1 → no1）', () => {
    const findings = scan('業界No.1の実績', { category: 'general', useDbRules: false });
    assert.ok(findings.some((f) => f.ruleId === 'yk-adv-04'), '最大級表現として検出されるべき');
  });

  test('問題のない文はスコア100・pass になる', () => {
    const findings = scan('毎日のスキンケアにお使いいただけます。', { category: 'cosmetics', useDbRules: false });
    const result = grade(findings);
    assert.equal(result.status, 'pass');
    assert.equal(result.score, 100);
  });

  test('block があればスコアが下がり status が block になる', () => {
    const findings = scan('医師も推薦。必ず治る。', { category: 'supplement', useDbRules: false });
    const result = grade(findings);
    assert.equal(result.status, 'block');
    assert.ok(result.score < 100);
  });

  test('検出位置が元テキストの index を指す', () => {
    const text = 'この美容液なら、シミが消える。';
    const findings = scan(text, { category: 'cosmetics', useDbRules: false });
    const hit = findings.find((f) => f.ruleId === 'yk-cos-01');
    assert.ok(hit);
    assert.ok(hit.index > 0 && hit.index < text.length);
  });

  test('辞書エントリのカテゴリ判定が allowedIn を優先する', () => {
    const entry = DICTIONARY.find((e) => e.id === 'yk-cure-01');
    assert.ok(entry);
    assert.equal(appliesTo(entry, 'drug'), false);
    assert.equal(appliesTo(entry, 'supplement'), true);
  });
});
