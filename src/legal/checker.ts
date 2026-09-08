import { completeJson } from '../providers/registry.ts';
import { legalReviews } from '../db/repositories/legal.ts';
import { advertisers } from '../db/repositories/orgs.ts';
import { createLogger } from '../lib/logger.ts';
import { parseJson } from '../db/sqlite.ts';
import { CATEGORY_LABELS } from './dictionary.ts';
import { grade, scan } from './scanner.ts';
import type { AdvertiserCategory, LegalFinding, LegalReview, Severity } from '../domain/types.ts';

const log = createLogger('legal');

export type CheckInput = {
  text: string;
  category: AdvertiserCategory;
  subjectType: 'script' | 'article_lp' | 'lp' | 'ad_copy' | 'deliverable' | 'storyboard';
  subjectId?: string;
  projectId?: string;
  advertiserId?: string;
  /** true なら LLM による文脈判定と修正文の生成まで行う */
  deep?: boolean;
  /** 修正案を自動生成して revisedText に入れる */
  autoRevise?: boolean;
};

export type CheckResult = {
  status: 'pass' | 'warn' | 'block';
  score: number;
  findings: LegalFinding[];
  revisedText: string | null;
  reviewId: string;
  category: AdvertiserCategory;
};

type LlmFinding = {
  phrase: string;
  law: 'yakkihou' | 'keihyo' | 'custom';
  severity: Severity;
  reason: string;
  suggestion: string;
};

const SYSTEM_PROMPT = `あなたは日本の広告審査担当者です。薬機法（医薬品医療機器等法）、医薬品等適正広告基準、
景品表示法（優良誤認・有利誤認・ステマ規制）、特定商取引法に基づき、広告表現を審査します。
判断は保守的に行い、グレーな表現は必ず指摘してください。指摘は必ず原文中の実在する文字列を phrase として引用します。`;

/** LLM による文脈判定。辞書では拾えない「言い換えによる暗示」を検出する。 */
async function llmReview(
  text: string,
  category: AdvertiserCategory,
  ruleFindings: LegalFinding[],
): Promise<LlmFinding[]> {
  const prompt = `# 審査対象カテゴリ
${CATEGORY_LABELS[category]}

# 審査対象テキスト
"""
${text.slice(0, 12000)}
"""

# ルールベースで既に検出済みの表現（重複して報告しないでください）
${ruleFindings.length ? ruleFindings.map((f) => `- ${f.phrase}`).join('\n') : '（なし）'}

# 指示
辞書照合では検出できない、以下のような「文脈上の違反」を抽出してください。
1. 直接的なNGワードを使わずに効能効果を暗示している表現（例:「毎朝スッキリ」で便通改善を暗示）
2. 打消し表示が不十分／過小な表現
3. 体験談・ビフォーアフターによる効果の保証
4. 条件を伏せた価格・特典の訴求
5. カテゴリの効能範囲を超える示唆

# 出力（JSONのみ）
\`\`\`json
{"findings":[{"phrase":"原文中の該当箇所","law":"yakkihou","severity":"warn","reason":"なぜ問題か","suggestion":"修正案"}]}
\`\`\``;

  const result = await completeJson<{ findings?: LlmFinding[] }>(
    { system: SYSTEM_PROMPT, prompt, temperature: 0.1, maxTokens: 3000, tag: 'legal.review' },
    { findings: [] },
  );
  return result.findings ?? [];
}

/** 指摘を踏まえた修正文の生成。訴求力を保ったまま適法化することが目的。 */
async function reviseText(
  text: string,
  category: AdvertiserCategory,
  findings: LegalFinding[],
): Promise<string | null> {
  if (findings.length === 0) return null;
  const prompt = `# カテゴリ
${CATEGORY_LABELS[category]}

# 原文
"""
${text.slice(0, 12000)}
"""

# 指摘事項
${findings.map((f, i) => `${i + 1}. [${f.severity}] 「${f.phrase}」 — ${f.reason}\n   → ${f.suggestion ?? ''}`).join('\n')}

# 指示
すべての指摘を解消した修正版を作成してください。
- 構成・文量・トーンは維持する
- 訴求力を落とさず、適法な言い換えで置き換える
- 新たな違反表現を持ち込まない
- 本文のみを出力する（解説不要）

# 出力（JSONのみ）
\`\`\`json
{"revised":"修正後の全文"}
\`\`\``;

  const result = await completeJson<{ revised?: string }>(
    { system: SYSTEM_PROMPT, prompt, temperature: 0.3, maxTokens: 6000, tag: 'legal.revise' },
    {},
  );
  return result.revised?.trim() || null;
}

export async function check(input: CheckInput): Promise<CheckResult> {
  let extraNgWords: string[] = [];
  let category = input.category;

  if (input.advertiserId) {
    const adv = advertisers.find(input.advertiserId);
    if (adv) {
      category = adv.category;
      extraNgWords = parseJson<string[]>(adv.ng_words, []);
    }
  }

  const ruleFindings = scan(input.text, {
    category,
    advertiserId: input.advertiserId,
    extraNgWords,
  });

  let findings = ruleFindings;
  if (input.deep !== false) {
    try {
      const llmFindings = await llmReview(input.text, category, ruleFindings);
      for (const f of llmFindings) {
        const index = input.text.indexOf(f.phrase);
        findings = findings.concat({
          law: f.law ?? 'custom',
          severity: (['block', 'warn', 'info'] as const).includes(f.severity) ? f.severity : 'warn',
          phrase: f.phrase,
          context: f.phrase,
          index: index >= 0 ? index : 0,
          reason: f.reason,
          suggestion: f.suggestion ?? null,
          source: 'llm',
        });
      }
    } catch (err) {
      // LLM が落ちてもルールベースの結果は必ず返す（審査を止めない）
      log.warn('LLMレビューに失敗。ルールベースの結果のみで判定します', { error: String(err) });
    }
  }

  const { status, score } = grade(findings);

  let revisedText: string | null = null;
  if (input.autoRevise && status !== 'pass') {
    try {
      const candidate = await reviseText(input.text, category, findings);
      // 極端に短い「修正案」は本文の切り落とし。原文を壊すくらいなら採用しない。
      if (candidate && candidate.length >= input.text.length * 0.4) {
        revisedText = candidate;
      } else if (candidate) {
        log.warn('修正案が原文に比べて短すぎるため採用しません', {
          originalChars: input.text.length, revisedChars: candidate.length,
        });
      }
    } catch (err) {
      log.warn('修正案の生成に失敗', { error: String(err) });
    }
  }

  const review = legalReviews.create({
    project_id: input.projectId ?? null,
    subject_type: input.subjectType,
    subject_id: input.subjectId ?? null,
    category,
    engine: input.deep === false ? 'rules' : 'hybrid',
    status,
    score,
    findings,
    original_text: input.text.slice(0, 100_000),
    revised_text: revisedText,
  });

  log.info('法務チェック完了', {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    status,
    score,
    findings: findings.length,
  });

  return { status, score, findings, revisedText, reviewId: review.id, category };
}

/** 保存済みレビューを findings 付きで読み出す */
export function toDto(review: LegalReview): Omit<LegalReview, 'findings'> & { findings: LegalFinding[] } {
  return { ...review, findings: parseJson<LegalFinding[]>(review.findings, []) };
}
