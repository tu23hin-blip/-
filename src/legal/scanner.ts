import { normalizeWithMap } from '../lib/text.ts';
import { DICTIONARY, appliesTo, type DictEntry } from './dictionary.ts';
import { legalRules, type LegalRuleRow } from '../db/repositories/legal.ts';
import type { AdvertiserCategory, LegalFinding, Severity } from '../domain/types.ts';

/**
 * ルールベースの一次スクリーニング。
 *
 * 「スペースや記号を挟んで NG 語を分断する」抜け道を塞ぐため、
 * 全角→半角・記号除去・小文字化した文字列で照合し、
 * ヒット位置は元テキストの index に戻して返す。
 */
export type ScanOptions = {
  category: AdvertiserCategory;
  advertiserId?: string;
  /** 広告主固有の追加NGワード（ブランドガイド由来） */
  extraNgWords?: string[];
  /** DB に登録されたカスタムルールも使うか */
  useDbRules?: boolean;
};

function toFinding(
  law: LegalFinding['law'],
  severity: Severity,
  original: string,
  originalIndex: number,
  matched: string,
  reason: string,
  suggestion: string | null,
  ruleId: string,
): LegalFinding {
  const start = Math.max(0, originalIndex - 12);
  const context = original.slice(start, Math.min(original.length, originalIndex + matched.length + 12));
  return {
    law,
    severity,
    phrase: matched,
    context: context.trim(),
    index: originalIndex,
    reason,
    suggestion,
    ruleId,
    source: 'rules',
  };
}

function matchPattern(
  normalized: string,
  map: number[],
  original: string,
  pattern: string,
  isRegex: boolean,
): { index: number; text: string }[] {
  const hits: { index: number; text: string }[] = [];
  if (isRegex) {
    let re: RegExp;
    try {
      // 照合先は小文字化済みなので、パターン側は大文字小文字を無視する
      re = new RegExp(pattern, 'gi');
    } catch {
      return hits;
    }
    for (const m of normalized.matchAll(re)) {
      if (m.index === undefined) continue;
      const from = map[m.index] ?? 0;
      // 正規化後の一致長を元テキスト上の範囲に戻す（記号や空白を挟んでいても正しく切り出す）
      const to = (map[m.index + m[0].length - 1] ?? from) + 1;
      hits.push({ index: from, text: original.slice(from, to) });
    }
    return hits;
  }
  const needle = pattern.replace(/[\s　]/g, '').toLowerCase();
  if (!needle) return hits;
  let cursor = 0;
  for (;;) {
    const at = normalized.indexOf(needle, cursor);
    if (at < 0) break;
    const from = map[at] ?? 0;
    const to = (map[at + needle.length - 1] ?? from) + 1;
    hits.push({ index: from, text: original.slice(from, to) });
    cursor = at + needle.length;
  }
  return hits;
}

export function scan(text: string, opts: ScanOptions): LegalFinding[] {
  const { normalized, map } = normalizeWithMap(text);
  const findings: LegalFinding[] = [];

  // 1) 組み込み辞書（薬機法 / 景表法）
  for (const entry of DICTIONARY) {
    if (!appliesTo(entry, opts.category)) continue;
    for (const hit of matchPattern(normalized, map, text, entry.pattern, entry.isRegex ?? false)) {
      findings.push(
        toFinding(entry.law, entry.severity, text, hit.index, hit.text, entry.reason, entry.suggestion, entry.id),
      );
    }
  }

  // 2) DB のカスタムルール（広告主固有の運用ルールなど）
  if (opts.useDbRules !== false) {
    let rules: LegalRuleRow[] = [];
    try {
      rules = legalRules.active(opts.advertiserId);
    } catch {
      rules = [];
    }
    for (const rule of rules) {
      if (rule.category && rule.category !== opts.category) continue;
      for (const hit of matchPattern(normalized, map, text, rule.pattern, rule.is_regex === 1)) {
        findings.push(
          toFinding(rule.law, rule.severity, text, hit.index, hit.text, rule.reason, rule.suggestion, rule.id),
        );
      }
    }
  }

  // 3) ブランドガイド由来の禁止語
  for (const word of opts.extraNgWords ?? []) {
    for (const hit of matchPattern(normalized, map, text, word, false)) {
      findings.push(
        toFinding('custom', 'warn', text, hit.index, hit.text,
          `ブランドガイドで禁止されている表現「${word}」が含まれています。`,
          '広告主のブランドガイドに沿った表現に置き換える。', `brand:${word}`),
      );
    }
  }

  // 同一位置・同一ルールの重複を除去し、重篤度→出現位置の順に並べる
  const seen = new Set<string>();
  const weight: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  return findings
    .filter((f) => {
      const key = `${f.ruleId}@${f.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => weight[a.severity] - weight[b.severity] || a.index - b.index);
}

/** findings から総合ステータスとスコア（100点減点法）を導く */
export function grade(findings: LegalFinding[]): { status: 'pass' | 'warn' | 'block'; score: number } {
  let score = 100;
  for (const f of findings) {
    score -= f.severity === 'block' ? 25 : f.severity === 'warn' ? 8 : 2;
  }
  score = Math.max(0, score);
  const status = findings.some((f) => f.severity === 'block')
    ? 'block'
    : findings.some((f) => f.severity === 'warn')
      ? 'warn'
      : 'pass';
  return { status, score };
}

export function dictionarySize(): number {
  return DICTIONARY.length;
}

export type { DictEntry };
