// 校閲結果の合否判定。AIの判定と、プロンプトに書いた判定ルールをコード側でも当てはめ、厳しい方を採る

export const CHECKS = ['fact', 'no_hallucination', 'paid_value', 'free_value', 'originality', 'readability', 'ai_smell', 'claims', 'compliance', 'diagrams', 'structure'];
export const CRITICAL_CHECKS = ['fact', 'no_hallucination', 'claims', 'compliance'];
export const MAX_REWRITES = 2;

const RANK = { pass: 0, revise: 1, human_review: 2 };
const stricter = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// systemIssues: コードで見つけた形式の問題（マーカー・有料ライン）
export function decideReview(review, systemIssues = []) {
  const aiVerdict = RANK[review?.verdict] !== undefined ? review.verdict : 'revise';
  const checks = review?.checks || {};
  // 結果が書かれていない項目は「確認できていない」とみなして不合格にする
  const failed = CHECKS.filter((k) => String(checks[k] ?? 'fail').toLowerCase() !== 'pass');
  const critical = failed.filter((k) => CRITICAL_CHECKS.includes(k));
  const reasons = [];
  let rule = 'pass';
  if (critical.length) {
    rule = aiVerdict === 'human_review' ? 'human_review' : 'revise';
    reasons.push(`重要項目（${critical.join(', ')}）が不合格`);
  } else if (failed.length >= 2) {
    rule = 'revise';
    reasons.push(`不合格の項目が${failed.length}つ（${failed.join(', ')}）`);
  }
  const score = Number(review?.quality_score);
  if (!(score >= 70)) {
    rule = stricter(rule, 'revise');
    reasons.push(`品質スコアが${Number.isFinite(score) ? score : '不明'}（70未満）`);
  }
  if (systemIssues.length) {
    rule = stricter(rule, 'revise');
    reasons.push(`形式の問題が${systemIssues.length}件`);
  }
  const issues = [
    ...(Array.isArray(review?.issues) ? review.issues : []),
    ...systemIssues.map((problem) => ({ check: 'structure', location: '本文の形式', problem, fix: '指摘どおりに直す' })),
  ];
  return { verdict: stricter(aiVerdict, rule), ai_verdict: aiVerdict, failed, reasons, issues, quality_score: Number.isFinite(score) ? score : null };
}

export function formatFeedback(decision) {
  const lines = decision.issues.map((i) => `- [${i.check || '指摘'}] ${i.location ? `${i.location}：` : ''}${i.problem}${i.fix ? ` → ${i.fix}` : ''}`);
  return `前回の校閲で次の指摘がありました。すべて直してください。\n${lines.join('\n') || `- ${decision.reasons.join(' / ')}`}`;
}
