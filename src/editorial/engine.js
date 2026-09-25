// AI編集部のコアロジック（UI・API非依存の純関数）
// 需要発見 → note制作 → X集客 → データ取得 → 勝ちパターン → 再投資 のループを支える。

// ① ネタ選定 ---------------------------------------------------------------

// 各指標は 0〜10 で入力。competition は「競合noteの多さ」なので反転して使う。
export const TOPIC_WEIGHTS = { search: 0.25, xReaction: 0.3, competitionGap: 0.2, monetizable: 0.25 };

const clamp = (n, min = 0, max = 10) => Math.min(max, Math.max(min, Number(n) || 0));

export function scoreTopic(topic) {
  const breakdown = {
    search: clamp(topic.search),
    xReaction: clamp(topic.xReaction),
    competitionGap: 10 - clamp(topic.competition),
    monetizable: clamp(topic.monetizable),
  };
  const total = Math.round(
    Object.entries(TOPIC_WEIGHTS).reduce((sum, [k, w]) => sum + breakdown[k] * w, 0) * 10
  );
  // Xで既に当たったネタ（反応8以上）は「Xでテスト → note化」の逆方向ルートとして優先する
  const provenOnX = breakdown.xReaction >= 8;
  let verdict = '見送り';
  if (total >= 70 || (provenOnX && total >= 55)) verdict = 'note化';
  else if (total >= 50) verdict = 'Xでテスト';
  return { ...topic, total, breakdown, verdict, provenOnX };
}

export function rankTopics(topics) {
  return topics.map(scoreTopic).sort((a, b) => b.total - a.total);
}

// ③ X投稿の配分 -------------------------------------------------------------

// X単体で価値がある状態を保つための初期配分（宣伝は1割まで）
export const X_MIX = [
  { key: 'value', label: '単体で役立つ情報', ratio: 0.5 },
  { key: 'experiment', label: '実験・結果', ratio: 0.2 },
  { key: 'opinion', label: '意見・考察', ratio: 0.2 },
  { key: 'cta', label: 'noteへの導線', ratio: 0.1 },
];

// 最大剰余法で投稿本数をカテゴリに割り振る
export function allocateMix(total, mix = X_MIX) {
  const raw = mix.map((m) => ({ ...m, exact: total * m.ratio }));
  const counts = raw.map((m) => ({ ...m, count: Math.floor(m.exact) }));
  let rest = total - counts.reduce((s, m) => s + m.count, 0);
  [...counts]
    .sort((a, b) => (b.exact % 1) - (a.exact % 1))
    .forEach((m) => {
      if (rest > 0) {
        m.count += 1;
        rest -= 1;
      }
    });
  return counts.map(({ exact, ...m }) => m);
}

// smooth weighted round-robin で並べ、同じカテゴリ（特に導線）が連続しにくいようにする
export function planSchedule(postsPerDay, days = 7, mix = X_MIX) {
  const counts = allocateMix(postsPerDay * days, mix);
  const state = counts.map((m) => ({ key: m.key, label: m.label, weight: m.count, current: 0, left: m.count }));
  const total = state.reduce((s, m) => s + m.weight, 0);
  const order = [];
  for (let i = 0; i < total; i++) {
    const live = state.filter((m) => m.left > 0);
    live.forEach((m) => (m.current += m.weight));
    const pick = live.reduce((best, m) => (m.current > best.current ? m : best));
    pick.current -= total;
    pick.left -= 1;
    order.push({ key: pick.key, label: pick.label });
  }
  return Array.from({ length: days }, (_, d) => ({
    day: d + 1,
    posts: order.slice(d * postsPerDay, (d + 1) * postsPerDay),
  }));
}

// 1本のnoteからX投稿の下書き枠を作る（本文はLLMが埋める前提のたたき台）
export const REPURPOSE_SET = [
  { type: 'short', label: '短文投稿', count: 3, category: 'value' },
  { type: 'knowhow', label: 'ノウハウ投稿', count: 2, category: 'value' },
  { type: 'long', label: '長文投稿', count: 1, category: 'experiment' },
  { type: 'cta', label: 'note誘導投稿', count: 1, category: 'cta' },
];

export function repurposeNote(note) {
  const points = note.keyPoints?.length ? note.keyPoints : [note.title];
  const pick = (i) => points[i % points.length];
  const numbered = points.map((p, n) => `${'①②③④⑤⑥⑦⑧⑨'[n] || '・'}${p}`).join('\n');
  // 同じ文面の使い回しにならないよう、投稿ごとに切り口を変える
  const shortAngles = [
    () => note.hook,
    (p) => `一番時間がかかるのは記事を書くことじゃなく「${p}」だった。\nここを仕組み化すると作業量が一気に減る。`,
    (p) => `「${p}」をAIに任せるときのコツは、\n最初から全部任せないこと。\n人間が判断する場所を1つだけ残す。`,
  ];
  const knowhowAngles = [
    () => `${note.title}\n\n結論、見るべきポイントはこれだけ。\n${numbered}`,
    (p) => `よくある失敗：いきなり全部自動化する。\n\nおすすめの順番\n1. まず「${p}」だけ手作業で10回やる\n2. 型をプロンプトにする\n3. 数字が出てから自動化する`,
  ];
  const drafts = [];
  REPURPOSE_SET.forEach(({ type, label, count, category }) => {
    for (let i = 0; i < count; i++) {
      let text;
      if (type === 'short') text = shortAngles[i % shortAngles.length](pick(i));
      else if (type === 'knowhow') text = knowhowAngles[i % knowhowAngles.length](pick(i + 1));
      else if (type === 'long')
        text = `【実験レポート】${note.title}\n\n${note.result || ''}\n\n${points.map((p) => `・${p}`).join('\n')}`;
      else text = `${note.title}\n\n無料部分：何をやったか\n有料部分：プロンプト・具体的フロー・テンプレ\n\n${note.url || '(URL)'}`;
      drafts.push({ id: `${type}-${i + 1}`, type, label, category, text: text.trim() });
    }
  });
  return drafts;
}

// X自動化ルール対策：同一・類似投稿の連投を避けるため、文字bigramのJaccard係数で近似重複を検出する
const bigrams = (s) => {
  const t = String(s).replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};

export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  A.forEach((g) => B.has(g) && inter++);
  return inter / (A.size + B.size - inter);
}

export function findNearDuplicates(posts, threshold = 0.6) {
  const hits = [];
  for (let i = 0; i < posts.length; i++)
    for (let j = i + 1; j < posts.length; j++) {
      const score = similarity(posts[i].text, posts[j].text);
      if (score >= threshold) hits.push({ a: posts[i].id, b: posts[j].id, score: Math.round(score * 100) / 100 });
    }
  return hits;
}

// ⑤ データ収集・分析 --------------------------------------------------------

const rate = (num, den) => (den > 0 ? num / den : 0);

// X → プロフィール → note → 購入 のファネル
export function funnel(m) {
  const steps = [
    ['X インプレッション', m.impressions],
    ['プロフィール遷移', m.profileVisits],
    ['リンククリック', m.linkClicks],
    ['note PV（全流入）', m.noteViews],
    ['購入', m.purchases],
  ];
  return steps.map(([label, value], i) => ({
    label,
    value: value || 0,
    stepRate: i === 0 ? 1 : rate(value, steps[i - 1][1]),
  }));
}

// ⑥ 勝ちパターン抽出：記事ごとの実績を切り口別に集計し、平均を上回る要素を洗い出す
export function extractPatterns(records, dimensions = ['theme', 'hook', 'price'], minSamples = 2) {
  const totals = records.reduce(
    (t, r) => ({ views: t.views + r.noteViews, clicks: t.clicks + r.linkClicks, imps: t.imps + r.impressions, sales: t.sales + r.purchases * r.price }),
    { views: 0, clicks: 0, imps: 0, sales: 0 }
  );
  const baseRpv = rate(totals.sales, totals.views);
  const baseCtr = rate(totals.clicks, totals.imps);
  const patterns = [];
  dimensions.forEach((dim) => {
    const groups = {};
    records.forEach((r) => {
      const g = (groups[r[dim]] ||= { views: 0, clicks: 0, imps: 0, sales: 0, purchases: 0, n: 0 });
      g.views += r.noteViews;
      g.clicks += r.linkClicks;
      g.imps += r.impressions;
      g.sales += r.purchases * r.price;
      g.purchases += r.purchases;
      g.n += 1;
    });
    Object.entries(groups).forEach(([value, g]) => {
      if (g.n < minSamples) return;
      const rpv = rate(g.sales, g.views);
      const ctr = rate(g.clicks, g.imps);
      patterns.push({
        dimension: dim,
        value,
        samples: g.n,
        revenue: g.sales,
        revenuePerView: rpv,
        ctr,
        rpvLift: baseRpv ? rpv / baseRpv - 1 : 0,
        ctrLift: baseCtr ? ctr / baseCtr - 1 : 0,
        cvr: rate(g.purchases, g.views),
      });
    });
  });
  return patterns.sort((a, b) => b.rpvLift - a.rpvLift);
}

const DIM_TEXT = {
  theme: (v) => `「${v}」系の記事が売れる`,
  hook: (v) => `「${v}」型のHookはCTRが高い`,
  price: (v) => `${Number(v).toLocaleString('ja-JP')}円でもCVする`,
};

export function insights(patterns, minLift = 0.15) {
  return patterns
    .filter((p) => (p.dimension === 'hook' ? p.ctrLift : p.rpvLift) >= minLift)
    .map((p) => {
      const lift = p.dimension === 'hook' ? p.ctrLift : p.rpvLift;
      const metric = p.dimension === 'hook' ? 'CTR' : 'PVあたり売上';
      return { ...p, text: DIM_TEXT[p.dimension]?.(p.value) || `${p.dimension}=${p.value} が好調`, note: `${metric} 平均比 +${Math.round(lift * 100)}%（n=${p.samples}）` };
    });
}

// 30日ロードマップ ------------------------------------------------------------

// 学習データが揃うまでは半自動。数字が揃ったら次のフェーズへ進む。
export const PHASES = [
  { id: 1, name: 'ジャンル・ペルソナ・商品設計', gate: () => true },
  { id: 2, name: 'note/Xを20〜30本テスト', gate: (s) => s.conceptFixed },
  { id: 3, name: '数字から勝ちパターン抽出', gate: (s) => s.publishedNotes >= 20 },
  { id: 4, name: '生成を自動化', gate: (s) => s.publishedNotes >= 20 && s.patterns >= 3 },
  { id: 5, name: '投稿・分析・改善まで自動化', gate: (s) => s.publishedNotes >= 30 && s.patterns >= 5 && s.autoDraftApproval >= 0.8 },
];

export function currentPhase(stats) {
  let phase = PHASES[0];
  for (const p of PHASES) {
    if (!p.gate(stats)) break;
    phase = p;
  }
  return phase;
}
