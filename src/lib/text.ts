/** 文字列処理の共通ヘルパ（テンプレート展開・全角半角・要約など） */

/** {{key}} / {{a.b}} を差し込む最小テンプレートエンジン */
export function render(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
      return undefined;
    }, vars);
    return value === undefined || value === null ? '' : String(value);
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 全角英数字・記号を半角に寄せる（法務チェックのすり抜け対策） */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/**
 * 法務チェック用の正規化：全角→半角、記号・空白・改行の除去、小文字化。
 * ただし「%」だけは残す。「100%保証」「満足度95%」のように、%自体が
 * 景表法上の判定対象になる表現を構成するため。
 */
export function normalizeForScan(s: string): string {
  return toHalfWidth(s)
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[!-$&-\/:-@\[-`{-~｡-ﾟ・、。！？「」『』（）]/g, '');
}

/** 正規化後インデックス → 元テキストのインデックスへ戻すためのマップを作る */
export function normalizeWithMap(s: string): { normalized: string; map: number[] } {
  const map: number[] = [];
  let normalized = '';
  const half = toHalfWidth(s);
  for (let i = 0; i < half.length; i++) {
    const ch = half.charAt(i);
    if (/[\s　]/.test(ch)) continue;
    if (/[!-$&-\/:-@\[-`{-~｡-ﾟ・、。！？「」『』（）]/.test(ch)) continue;
    normalized += ch.toLowerCase();
    map.push(i);
  }
  return { normalized, map };
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** 日本語テキストのおおよその読み上げ秒数（1分あたり約350文字＝ナレーション標準速） */
export function estimateNarrationSeconds(text: string): number {
  const chars = text.replace(/\s/g, '').length;
  return Math.max(0.6, Math.round((chars / 350) * 60 * 10) / 10);
}

export function stripJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start < 0) return body.trim();
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  return body.slice(start, end + 1).trim();
}
