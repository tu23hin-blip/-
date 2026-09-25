// X の文字数カウント（twitter-text v3 と同じ重み付け）。日本語などは1文字=2、半角英数などは1、URLは23として数え、280まで投稿できる。
export const X_LIMIT = 280;
export const NOTE_URL_PLACEHOLDER = '[noteのURL]';

const LIGHT_RANGES = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];

export function xWeightedLength(text) {
  const withoutUrls = String(text ?? '').replace(/https?:\/\/\S+/g, () => 'x'.repeat(23));
  let length = 0;
  for (const ch of withoutUrls.replaceAll(NOTE_URL_PLACEHOLDER, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0);
    length += LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  return length;
}

export const hasUrl = (text) => /https?:\/\/\S+/.test(String(text)) || String(text).includes(NOTE_URL_PLACEHOLDER);
