// 成果物の機械チェック。問題は「警告」として成果物に付け、人間が承認時に判断する。
// AI生成表記だけはルールなので、なければ自動で追記する。

const HYPE = [
  [/誰でも/, '「誰でも」は誇大表現になりやすい'],
  [/(必ず|確実に|絶対(に)?)\s*(稼|儲|成功|伸び)/, '「必ず／確実に／絶対」で成果を約束している'],
  [/放置で|ほったらかし|不労所得/, '「放置で／不労所得」系の表現'],
  [/月\s*[0-9０-９]+\s*万(円)?\s*(稼|以上|確定|達成)/, '月◯万円の収益訴求'],
  [/楽して|簡単に稼/, '「楽して／簡単に稼ぐ」系の表現'],
];
const AFFILIATE = /(amzn\.to|amazon\.co\.jp\/[^\s]*tag=|a8\.net|px\.a8|rakuten\.co\.jp\/[^\s]*(scid|afid)|moshimo|valuecommerce|accesstrade|afi-b|afb\.|af\.moshimo)/i;
const PR_MARK = /(^|\s|【|\[|#)(PR|広告|プロモーション)(】|\]|\s|$)/;
const AI_MARK = /(AI生成|AIを活用|AIで作成|AIを使って作成|AI下書き)/;

export const AI_FOOTER = {
  x_post: '※AI生成',
  note_article: '本記事はAIを活用して作成し、筆者が確認・編集しています。',
  script: '※AIを活用して制作',
  video: '※AIを活用して制作',
  report: '※AIを活用して作成',
};

export function charCount(s) { return Array.from(String(s).trim()).length; }

/** @returns {{ body: string, warnings: string[] }} */
export function checkOutput(kind, body, { minChars, maxChars, max_seconds: maxSeconds = null, prohibited = [] } = {}) {
  const warnings = [];
  let text = String(body || '').trim();
  for (const [re, msg] of HYPE) if (re.test(text)) warnings.push(`誇大表現の可能性: ${msg}`);
  if (AFFILIATE.test(text) && !PR_MARK.test(text)) warnings.push('アフィリエイト/広告の可能性があるのに「PR」「広告」の表記がありません（ステマ規制）');
  if (!AI_MARK.test(text)) {
    text = `${text}\n${kind === 'note_article' ? '\n' : ''}${AI_FOOTER[kind] || '※AI生成'}`;
    warnings.push('AI生成の表記がなかったため自動で追記しました');
  }
  if (kind === 'x_post') {
    const n = charCount(text);
    const lo = minChars ?? 140, hi = maxChars ?? 280;
    if (n < lo || n > hi) warnings.push(`文字数が ${lo}〜${hi}字の範囲外です（${n}字）`);
  }
  if (kind === 'note_article') {
    if (!/無料部分/.test(text) || !/有料部分/.test(text)) warnings.push('「無料部分」と「有料部分」の区切りが見つかりません');
    if (/【要記入/.test(text)) warnings.push('【要記入】の箇所があります。実体験・数字を人間が書き足してください');
  }
  if (maxSeconds && (kind === 'script' || kind === 'video')) {
    const secs = [...text.matchAll(/(\d+)\s*秒/g)].map((m) => Number(m[1]))
      .concat([...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((m) => Number(m[1]) * 60 + Number(m[2])));
    const max = secs.length ? Math.max(...secs) : null;
    if (max == null) warnings.push('秒数の表記が見つかりません（尺を確認してください）');
    else if (max > maxSeconds) warnings.push(`尺が ${maxSeconds}秒を超えている可能性があります（最大 ${max}秒）`);
  }
  for (const p of prohibited) {
    if (p && typeof p === 'string' && p.length >= 2 && text.includes(p)) warnings.push(`禁止事項に関わる語を含みます: ${p}`);
  }
  return { body: text, warnings };
}
