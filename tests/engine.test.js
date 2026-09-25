import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTopic, rankTopics, allocateMix, planSchedule, repurposeNote, similarity,
  findNearDuplicates, funnel, extractPatterns, insights, currentPhase,
} from '../src/editorial/engine.js';

test('scoreTopic: 高需要・低競合はnote化', () => {
  const r = scoreTopic({ search: 9, xReaction: 8, competition: 2, monetizable: 9 });
  assert.equal(r.total, 85);
  assert.equal(r.verdict, 'note化');
});

test('scoreTopic: Xで当たったネタは閾値を下げてnote化', () => {
  const r = scoreTopic({ search: 3, xReaction: 9, competition: 5, monetizable: 6 });
  assert.ok(r.total >= 55 && r.total < 70);
  assert.equal(r.verdict, 'note化');
});

test('scoreTopic: 中程度はXでテスト、低いものは見送り', () => {
  assert.equal(scoreTopic({ search: 6, xReaction: 5, competition: 5, monetizable: 6 }).verdict, 'Xでテスト');
  assert.equal(scoreTopic({ search: 1, xReaction: 1, competition: 9, monetizable: 1 }).verdict, '見送り');
});

test('rankTopics は高スコア順', () => {
  const r = rankTopics([{ name: 'a', search: 1 }, { name: 'b', search: 10, xReaction: 10 }]);
  assert.equal(r[0].name, 'b');
});

test('allocateMix は合計を保ち 50/20/20/10 に近い', () => {
  const c = allocateMix(21);
  assert.equal(c.reduce((s, m) => s + m.count, 0), 21);
  assert.deepEqual(c.map((m) => m.count), [11, 4, 4, 2]);
});

test('planSchedule は日数×本数を生成し、導線投稿を連続させない', () => {
  const plan = planSchedule(3, 7);
  const flat = plan.flatMap((d) => d.posts.map((p) => p.key));
  assert.equal(plan.length, 7);
  assert.equal(flat.length, 21);
  for (let i = 1; i < flat.length; i++) assert.ok(!(flat[i] === 'cta' && flat[i - 1] === 'cta'));
});

test('repurposeNote は 短文3・ノウハウ2・長文1・誘導1 の7本', () => {
  const drafts = repurposeNote({ title: 'T', hook: 'H', keyPoints: ['ネタ探し', '競合調査', 'タイトル'], url: 'https://note.com/x' });
  assert.equal(drafts.length, 7);
  assert.equal(drafts.filter((d) => d.type === 'short').length, 3);
  assert.equal(drafts.filter((d) => d.category === 'cta').length, 1);
});

test('similarity / findNearDuplicates は類似投稿を検出する', () => {
  assert.equal(similarity('同じ文章です', '同じ文章です'), 1);
  const hits = findNearDuplicates([
    { id: 'a', text: 'AIでnoteを自動化したら1週間でこうなった' },
    { id: 'b', text: 'AIでnoteを自動化したら2週間でこうなった' },
    { id: 'c', text: '今日のランチはカレーでした' },
  ]);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].a, hits[0].b], ['a', 'b']);
});

test('funnel はステップ遷移率を計算する', () => {
  const f = funnel({ impressions: 1000, profileVisits: 100, linkClicks: 50, noteViews: 40, purchases: 2 });
  assert.equal(f[1].stepRate, 0.1);
  assert.equal(f[4].stepRate, 0.05);
});

test('extractPatterns / insights は平均を上回る切り口を抽出する', () => {
  const base = { impressions: 1000, linkClicks: 10, noteViews: 100 };
  const records = [
    { ...base, theme: 'AI自動化', hook: '数字', price: 1480, purchases: 5 },
    { ...base, theme: 'AI自動化', hook: '数字', price: 1480, purchases: 4, linkClicks: 30 },
    { ...base, theme: '雑記', hook: '問いかけ', price: 500, purchases: 1 },
    { ...base, theme: '雑記', hook: '問いかけ', price: 500, purchases: 0 },
  ];
  const p = extractPatterns(records);
  assert.equal(p[0].value, 'AI自動化');
  const texts = insights(p).map((i) => i.text);
  assert.ok(texts.includes('「AI自動化」系の記事が売れる'));
  assert.ok(texts.includes('「数字」型のHookはCTRが高い'));
  assert.ok(texts.includes('1,480円でもCVする'));
});

test('currentPhase はデータ量に応じて進む', () => {
  assert.equal(currentPhase({ conceptFixed: false }).id, 1);
  assert.equal(currentPhase({ conceptFixed: true, publishedNotes: 8 }).id, 2);
  assert.equal(currentPhase({ conceptFixed: true, publishedNotes: 22, patterns: 3 }).id, 4);
  assert.equal(currentPhase({ conceptFixed: true, publishedNotes: 31, patterns: 6, autoDraftApproval: 0.9 }).id, 5);
});

test('repurposeNote の既定テンプレ自体は類似投稿判定に引っかからない', () => {
  const drafts = repurposeNote({
    title: 'AIでnoteを自動化して分かった「本当に時間がかかる工程」',
    hook: '記事を書くAIじゃなく「メディアを運営するAI」を作ると、作業時間は半分以下になる。',
    keyPoints: ['ネタ探し', '競合調査', 'タイトル作り', 'Xへの再利用'],
    result: '開始14日で note 12本・合計 8,400PV。',
    url: 'https://note.com/x',
  });
  assert.deepEqual(findNearDuplicates(drafts), []);
});
