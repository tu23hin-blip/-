import { advertisers } from '../db/repositories/orgs.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { assets, deliverables } from '../db/repositories/production.ts';
import { parseJson } from '../db/sqlite.ts';
import { check } from '../legal/checker.ts';
import { CATEGORY_LABELS } from '../legal/dictionary.ts';
import { completeJson, image } from '../providers/registry.ts';
import { pathFor, publicUrl, save } from '../providers/storage/local.ts';
import { runPipeline, type Step } from './engine.ts';
import {
  STANDARD_DISCLAIMERS, applyRevisionToDoc, renderLp, toPlainText,
  type LpBlock, type LpDocument,
} from './lp-render.ts';
import type { Brief } from '../domain/types.ts';

/**
 * 通常LP（ランディングページ）の自動制作。
 * 記事LPと違い「買う理由を積み上げて即決させる」構成にする。
 */

type Ctx = {
  orderId: string;
  projectId: string;
  brief: Brief;
  documents: LpDocument[];
  deliverableIds: string[];
};

const SYSTEM = `あなたは日本のD2C・通販に強いLPディレクター兼コピーライターです。
ファーストビューで「誰の何を解決するか」を伝え、証拠→オファー→行動喚起で締める構成を得意とします。
薬機法・景品表示法を守った表現のみを使用します。`;

const DEFAULT_SECTIONS = [
  'ファーストビュー（誰の何を解決するか）',
  '共感（こんなお悩みありませんか）',
  '解決策の提示',
  '選ばれる理由（3つのポイント）',
  '他社比較',
  'お客様の声',
  '使い方（3ステップ）',
  '料金・オファー',
  'よくある質問',
  '最終CTA',
];

export async function runLpPipeline(orderId: string) {
  const order = orders.require(orderId);
  const project = projects.require(order.project_id);
  const advertiser = advertisers.require(project.advertiser_id);
  const brief = parseJson<Brief>(order.brief, {} as Brief);
  const variations = Math.min(3, Math.max(1, brief.variations ?? order.quantity ?? 1));

  const ctx: Ctx = { orderId, projectId: project.id, brief, documents: [], deliverableIds: [] };

  const steps: Step<Ctx>[] = [
    {
      name: 'copy',
      label: 'セールスコピーの作成',
      async run({ ctx, log }) {
        const sections = brief.sections?.length ? brief.sections : DEFAULT_SECTIONS;
        for (let v = 0; v < variations; v++) {
          const prompt = `# 商材
${brief.product ?? advertiser.product_name ?? advertiser.name}（${CATEGORY_LABELS[advertiser.category]}）

# ターゲット
${brief.target ?? '未指定'}

# 悩み
${(brief.painPoints ?? []).join(' / ') || '未指定'}

# 訴求ポイント
${(brief.usp ?? []).join(' / ') || '未指定'}

# オファー
${brief.offer ?? 'なし'}

# セクション構成
${sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

# 指示
上記構成でLPのコピーを作成してください。${variations > 1 ? `これは${v + 1}案目です。ファーストビューの訴求を他案と変えてください。` : ''}
- キャッチコピーは30文字以内、サブコピーは60文字以内
- ${CATEGORY_LABELS[advertiser.category]}として薬機法・景表法に違反する表現は使わない
- 他社比較を入れる場合は、事実として示せる項目のみ（曖昧な優位性の主張はしない）
- お客様の声は効果効能を保証しない書き方にする

# 出力（JSONのみ）
\`\`\`json
{"title":"キャッチコピー","subtitle":"サブコピー","blocks":[{"type":"lead","text":""},{"type":"heading","text":""},{"type":"paragraph","text":""},{"type":"list","items":[""]},{"type":"comparison","headers":["","自社","一般的な商品"],"rows":[["項目","○","△"]]},{"type":"quote","text":"","author":"30代 女性"},{"type":"faq","items":[{"q":"","a":""}]},{"type":"cta","label":"","url":"#form","note":""}]}
\`\`\``;

          const result = await completeJson<{ title?: string; subtitle?: string; blocks?: LpBlock[] }>(
            { system: SYSTEM, prompt, temperature: 0.8, maxTokens: 6000, tag: 'lp.copy' },
            {},
          );
          const blocks = (result.blocks ?? []).filter(isValidBlock);
          ctx.documents.push({
            kind: 'lp',
            title: result.title ?? `${brief.product ?? advertiser.name}`,
            subtitle: result.subtitle ?? (brief.usp ?? [])[0] ?? '',
            brandName: advertiser.name,
            prLabel: `${advertiser.name} 公式`,
            blocks: blocks.length >= 4 ? blocks : fallbackBlocks(brief, sections),
            ctaUrl: brief.landingUrl ?? advertiser.site_url ?? '#form',
            ctaLabel: brief.cta ?? '今すぐ申し込む',
            disclaimers: [...STANDARD_DISCLAIMERS, ...offerDisclaimers(brief)],
            legalLinks: [
              { label: '特定商取引法に基づく表記', url: `${brief.landingUrl ?? '#'}/tokushoho` },
              { label: 'プライバシーポリシー', url: `${brief.landingUrl ?? '#'}/privacy` },
            ],
          });
        }
        log.info('コピーを作成', { documents: ctx.documents.length });
        return ctx.documents.map((d) => ({ title: d.title, blocks: d.blocks.length }));
      },
    },

    {
      name: 'visual',
      label: 'ファーストビュー画像の生成',
      async run({ ctx, log }) {
        const provider = image();
        for (const [i, doc] of ctx.documents.entries()) {
          const prompt = `${brief.product ?? advertiser.name} のランディングページ用ヒーロービジュアル。${doc.title}。${brief.tone ?? '清潔感があり信頼できる印象'}。文字・ロゴは入れない。`;
          const result = await provider.generate({
            prompt,
            aspectRatio: '4:5',
            outputPath: pathFor({ projectId: ctx.projectId, orderId: ctx.orderId, kind: 'assets', name: `lp_${i + 1}_hero.png` }),
          });
          assets.create({
            project_id: ctx.projectId, order_id: ctx.orderId, source: 'ai_generated', kind: 'image',
            provider: result.provider, model: result.model, prompt,
            storage_path: result.storagePath, bytes: result.bytes,
            width: result.width, height: result.height, license_note: 'AI生成（LPヒーロー）',
          });
          doc.heroImage = publicUrl(result.storagePath);
        }
        log.info('ビジュアルを生成', { count: ctx.documents.length });
        return ctx.documents.map((d) => d.heroImage);
      },
    },

    {
      name: 'legal',
      label: '法務チェック',
      async run({ ctx, log }) {
        const results = [];
        for (const [i, doc] of ctx.documents.entries()) {
          const result = await check({
            text: toPlainText(doc),
            category: advertiser.category,
            subjectType: 'lp',
            subjectId: ctx.orderId,
            projectId: ctx.projectId,
            advertiserId: advertiser.id,
            deep: true,
            autoRevise: true,
          });
          if (result.status !== 'pass' && result.revisedText) {
            ctx.documents[i] = applyRevisionToDoc(doc, result.revisedText);
          }
          results.push({ title: doc.title, status: result.status, score: result.score, findings: result.findings.length });
        }
        log.info('法務チェック完了', { checked: results.length });
        return results;
      },
    },

    {
      name: 'publish',
      label: 'HTML書き出し・納品物登録',
      async run({ ctx, outputs, log }) {
        const legal = outputs['legal'] as { status: string; score: number }[];
        for (const [i, doc] of ctx.documents.entries()) {
          const html = renderLp(doc);
          const stored = save(
            pathFor({ projectId: ctx.projectId, orderId: ctx.orderId, kind: 'lp', name: `lp_${i + 1}.html` }),
            html,
          );
          const status = legal[i]?.status ?? 'pass';
          const deliverable = deliverables.create({
            order_id: ctx.orderId,
            project_id: ctx.projectId,
            kind: 'lp',
            title: doc.title,
            status: 'rendered',
            storage_path: stored.path,
            preview_path: stored.path,
            content: html,
            legal_status: status === 'block' ? 'block' : status === 'warn' ? 'warn' : 'pass',
            spec: JSON.stringify({
              blocks: doc.blocks.length,
              chars: toPlainText(doc).length,
              ctaUrl: doc.ctaUrl,
              legalScore: legal[i]?.score ?? null,
              url: publicUrl(stored.path),
            }),
            qc: JSON.stringify(qcLp(doc)),
          });
          ctx.deliverableIds.push(deliverable.id);
        }
        log.info('LPを書き出し', { count: ctx.deliverableIds.length });
        return ctx.deliverableIds;
      },
    },
  ];

  return runPipeline<Ctx>(orderId, 'lp', steps, ctx);
}

function isValidBlock(block: unknown): block is LpBlock {
  if (!block || typeof block !== 'object') return false;
  const type = (block as { type?: string }).type;
  return ['lead', 'heading', 'paragraph', 'list', 'quote', 'callout', 'image', 'comparison', 'faq', 'cta'].includes(type ?? '');
}

function qcLp(doc: LpDocument): Record<string, unknown> {
  const text = toPlainText(doc);
  const issues: string[] = [];
  if (doc.title.length > 32) issues.push(`キャッチコピーが長い（${doc.title.length}文字）`);
  if (!doc.blocks.some((b) => b.type === 'cta')) issues.push('本文中CTAがありません');
  if (!doc.blocks.some((b) => b.type === 'faq')) issues.push('FAQがありません');
  if (!doc.legalLinks?.some((l) => l.label.includes('特定商取引法'))) issues.push('特商法表記へのリンクがありません');
  if (text.length < 500) issues.push(`情報量が不足（${text.length}文字）`);
  return { checkedAt: new Date().toISOString(), chars: text.length, issues, passed: issues.length === 0 };
}

function offerDisclaimers(brief: Brief): string[] {
  if (!brief.offer) return [];
  return [
    '表示価格は税込です。送料は別途かかる場合があります。',
    '定期コースの場合、継続回数・解約条件・総額は特定商取引法に基づく表記をご確認ください。',
  ];
}

function fallbackBlocks(brief: Brief, sections: string[]): LpBlock[] {
  const blocks: LpBlock[] = [{ type: 'lead', text: brief.usp?.[0] ?? '選ばれ続けている理由があります。' }];
  for (const section of sections.slice(1)) {
    blocks.push({ type: 'heading', text: section });
    blocks.push({ type: 'paragraph', text: `${section}に関する説明を掲載します。` });
  }
  blocks.push({ type: 'cta', label: brief.cta ?? '今すぐ申し込む', url: brief.landingUrl ?? '#form', note: brief.offer ?? '' });
  return blocks;
}
