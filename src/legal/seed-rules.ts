import { legalRules } from '../db/repositories/legal.ts';
import { createLogger } from '../lib/logger.ts';

const log = createLogger('legal:seed');

/**
 * DB 側のカスタムルールの初期投入。
 * 組み込み辞書（dictionary.ts）とは別に、運用しながら足していく想定のものを入れる。
 * 組み込み辞書がコードの一部＝レビュー対象なのに対し、こちらは運用者が画面から編集できる。
 */
const SEEDS = [
  {
    law: 'keihyo' as const, pattern: '(業界初|日本初|世界初)', is_regex: 1, severity: 'warn' as const,
    reason: '「初」の表示は客観的な裏付け（調査時点・調査範囲）が必要。',
    suggestion: '「2026年1月時点、当社調べ」等の条件を近接表示する。',
  },
  {
    law: 'keihyo' as const, pattern: '(満足度9[0-9]%|9[0-9]%が実感)', is_regex: 1, severity: 'warn' as const,
    reason: 'アンケート結果の表示は、調査対象者数・調査方法・質問文の明示が必要。',
    suggestion: '「n=◯◯名、自社アンケート、2026年◯月実施」を併記する。',
  },
  {
    law: 'yakkihou' as const, pattern: '(飲むだけで|塗るだけで|貼るだけで)', is_regex: 1, severity: 'warn' as const,
    reason: '簡便性の強調は、効果の保証・誇大広告と評価されるおそれがある。',
    suggestion: '使用方法の説明にとどめ、効果との因果を断定しない。',
  },
  {
    law: 'yakkihou' as const, pattern: '(ステロイド不使用|無添加)', is_regex: 1, severity: 'info' as const,
    reason: '「無添加」は何を添加していないかの明示が必要。他社比較として優良誤認になりうる。',
    suggestion: '「◯◯無添加」と対象成分を明記する。',
  },
  {
    law: 'custom' as const, pattern: '(激安|投げ売り|叩き売り)', is_regex: 1, severity: 'info' as const,
    reason: 'ブランド毀損のおそれがある表現。',
    suggestion: '価格訴求は「初回限定価格」等の中立的な表現にする。',
  },
];

export function seedLegalRules(): number {
  if (legalRules.count() > 0) return 0;
  for (const seed of SEEDS) {
    legalRules.create({
      scope: 'global',
      law: seed.law,
      category: null,
      pattern: seed.pattern,
      is_regex: seed.is_regex,
      severity: seed.severity,
      reason: seed.reason,
      suggestion: seed.suggestion,
      enabled: 1,
    });
  }
  log.info('法務ルールを初期投入', { count: SEEDS.length });
  return SEEDS.length;
}
