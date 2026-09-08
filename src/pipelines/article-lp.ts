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
 * 記事LP（記事型ランディングページ）の自動制作。
 *
 * 記事LPは「広告に見えないこと」で成果を出す形式のため、
 * ステマ規制（景表法の指定告示）への対応が必須。
 * このパイプラインでは PR表記の挿入を任意項目にせず、常に強制する。
 */

type Ctx = {
  orderId: string;
  projectId: string;
  brief: Brief;
  documents: LpDocument[];
  deliverableIds: string[];
};

const SYSTEM = `あなたは日本の記事型ランディングページ（記事LP）を専門とするセールスライターです。
読み物として自然に読み進められる構成と、ダイレクトレスポンスの型（PASONA / QUEST）を両立させます。
薬機法・景品表示法に抵触する表現は書きません。`;

export async function runArticleLpPipeline(orderId: string) {
  const order = orders.require(orderId);
  const project = projects.require(order.project_id);
  const advertiser = advertisers.require(project.advertiser_id);
  const brief = parseJson<Brief>(order.brief, {} as Brief);
  const variations = Math.min(3, Math.max(1, brief.variations ?? order.quantity ?? 1));

  const ctx: Ctx = { orderId, projectId: project.id, brief, documents: [], deliverableIds: [] };

  const steps: Step<Ctx>[] = [
    {
      name: 'outline',
      label: '記事構成の設計',
      async run({ log }) {
        const prompt = `# 商材
${brief.product ?? advertiser.product_name ?? advertiser.name}（${CATEGORY_LABELS[advertiser.category]}）

# ターゲット
${brief.target ?? '未指定'}

# 悩み
${(brief.painPoints ?? []).map((p) => `- ${p}`).join('\n') || '- 未指定'}

# 訴求ポイント
${(brief.usp ?? []).join(' / ') || '未指定'}

# オファー
${brief.offer ?? 'なし'}

# 指示
記事LPの構成案を${variations}案作成してください。各案でタイトルの切り口（共感型／衝撃型／ノウハウ型／比較型）を変えること。
${CATEGORY_LABELS[advertiser.category]}として言えないこと（効能効果の断定・疾病の治療予防）は書かないでください。

# 出力（JSONのみ）
\`\`\`json
{"outlines":[{"title":"記事タイトル(35文字以内)","subtitle":"リード文の要約","angle":"切り口","sections":["セクション見出し1","セクション見出し2"]}]}
\`\`\``;
        const result = await completeJson<{ outlines?: { title: string; subtitle: string; angle: string; sections: string[] }[] }>(
          { system: SYSTEM, prompt, temperature: 0.85, maxTokens: 2500, tag: 'article.outline' },
          { outlines: [] },
        );
        const outlines = (result.outlines ?? []).slice(0, variations);
        if (outlines.length === 0) {
          outlines.push({
            title: `${brief.product ?? advertiser.name}を選ぶ前に知っておきたいこと`,
            subtitle: brief.usp?.[0] ?? '',
            angle: '共感型',
            sections: brief.sections ?? ['よくある悩み', '見落とされがちな原因', '選び方のポイント', '実際に使ってみた', 'よくある質問'],
          });
        }
        log.info('記事構成を作成', { count: outlines.length });
        return outlines;
      },
    },

    {
      name: 'draft',
      label: '本文執筆',
      async run({ ctx, outputs, log }) {
        const outlines = outputs['outline'] as { title: string; subtitle: string; angle: string; sections: string[] }[];
        for (const outline of outlines) {
          const prompt = `# 記事タイトル
${outline.title}

# 切り口
${outline.angle}

# セクション構成
${outline.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

# 商材
${brief.product ?? advertiser.name}（${CATEGORY_LABELS[advertiser.category]}）
訴求: ${(brief.usp ?? []).join(' / ')}
オファー: ${brief.offer ?? 'なし'}
CTA: ${brief.cta ?? '公式サイトで詳細を見る'}

# 制約
- 全体で${brief.wordCount ?? 1800}文字前後
- ${CATEGORY_LABELS[advertiser.category]}として薬機法・景表法に違反する表現を使わない
- 体験談を書く場合は効能効果を保証しない書き方にする
- 数値や比較を出す場合は根拠が示せる範囲にとどめる
- ブロックの種類は lead / heading / paragraph / list / quote / callout / comparison / faq / cta のみ

# 出力（JSONのみ）
\`\`\`json
{"blocks":[{"type":"lead","text":"リード文"},{"type":"heading","text":"見出し"},{"type":"paragraph","text":"本文"},{"type":"list","items":["項目"]},{"type":"faq","items":[{"q":"質問","a":"回答"}]},{"type":"cta","label":"ボタン文言","url":"#cta","note":"注記"}],"imagePrompts":["記事内画像の指示"]}
\`\`\``;

          const result = await completeJson<{ blocks?: LpBlock[]; imagePrompts?: string[] }>(
            { system: SYSTEM, prompt, temperature: 0.75, maxTokens: 6000, tag: 'article.draft' },
            { blocks: [] },
          );
          const blocks = (result.blocks ?? []).filter(isValidBlock);

          ctx.documents.push({
            kind: 'article_lp',
            title: outline.title,
            subtitle: outline.subtitle,
            brandName: advertiser.name,
            // ステマ規制対応: 消費者が明瞭に認識できる位置に固定表示
            prLabel: `PR｜${advertiser.name}提供`,
            blocks: blocks.length >= 4 ? blocks : fallbackBlocks(brief, outline.sections),
            ctaUrl: brief.landingUrl ?? advertiser.site_url ?? '#cta',
            ctaLabel: brief.cta ?? '公式サイトで詳細を見る',
            disclaimers: [...STANDARD_DISCLAIMERS, ...categoryDisclaimers(advertiser.category)],
            legalLinks: [
              { label: '特定商取引法に基づく表記', url: `${brief.landingUrl ?? '#'}/tokushoho` },
              { label: 'プライバシーポリシー', url: `${brief.landingUrl ?? '#'}/privacy` },
            ],
          });
        }
        log.info('本文を執筆', { documents: ctx.documents.length });
        return ctx.documents.map((d) => ({ title: d.title, blocks: d.blocks.length }));
      },
    },

    {
      name: 'images',
      label: 'アイキャッチ・記事内画像の生成',
      async run({ ctx, log }) {
        const provider = image();
        const created: string[] = [];
        for (const [i, doc] of ctx.documents.entries()) {
          const prompt = `${doc.title} を象徴する記事アイキャッチ。${brief.tone ?? '清潔感のあるナチュラルな雰囲気'}。文字は入れない。`;
          const result = await provider.generate({
            prompt,
            aspectRatio: '16:9',
            outputPath: pathFor({ projectId: ctx.projectId, orderId: ctx.orderId, kind: 'assets', name: `article_${i + 1}_hero.png` }),
          });
          assets.create({
            project_id: ctx.projectId, order_id: ctx.orderId, source: 'ai_generated', kind: 'image',
            provider: result.provider, model: result.model, prompt,
            storage_path: result.storagePath, bytes: result.bytes,
            width: result.width, height: result.height, license_note: 'AI生成（記事アイキャッチ）',
          });
          doc.heroImage = publicUrl(result.storagePath);
          created.push(result.storagePath);
        }
        log.info('画像を生成', { count: created.length });
        return created;
      },
    },

    {
      name: 'legal',
      label: '法務チェック（薬機法・景表法・ステマ規制）',
      async run({ ctx, log }) {
        const results = [];
        for (const [i, doc] of ctx.documents.entries()) {
          const result = await check({
            text: toPlainText(doc),
            category: advertiser.category,
            subjectType: 'article_lp',
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
            pathFor({ projectId: ctx.projectId, orderId: ctx.orderId, kind: 'lp', name: `article_${i + 1}.html` }),
            html,
          );
          const status = legal[i]?.status ?? 'pass';
          const deliverable = deliverables.create({
            order_id: ctx.orderId,
            project_id: ctx.projectId,
            kind: 'article_lp',
            title: doc.title,
            status: 'rendered',
            storage_path: stored.path,
            preview_path: stored.path,
            content: html,
            legal_status: status === 'block' ? 'block' : status === 'warn' ? 'warn' : 'pass',
            spec: JSON.stringify({
              blocks: doc.blocks.length,
              chars: toPlainText(doc).length,
              prLabel: doc.prLabel,
              ctaUrl: doc.ctaUrl,
              legalScore: legal[i]?.score ?? null,
              url: publicUrl(stored.path),
            }),
            qc: JSON.stringify(qcArticle(doc)),
          });
          ctx.deliverableIds.push(deliverable.id);
        }
        log.info('記事LPを書き出し', { count: ctx.deliverableIds.length });
        return ctx.deliverableIds;
      },
    },
  ];

  return runPipeline<Ctx>(orderId, 'article_lp', steps, ctx);
}

function isValidBlock(block: unknown): block is LpBlock {
  if (!block || typeof block !== 'object') return false;
  const type = (block as { type?: string }).type;
  return ['lead', 'heading', 'paragraph', 'list', 'quote', 'callout', 'image', 'comparison', 'faq', 'cta'].includes(type ?? '');
}

function qcArticle(doc: LpDocument): Record<string, unknown> {
  const text = toPlainText(doc);
  const issues: string[] = [];
  if (!doc.prLabel) issues.push('PR表記がありません（ステマ規制違反）');
  if (text.length < 600) issues.push(`本文が短すぎます（${text.length}文字）`);
  if (!doc.blocks.some((b) => b.type === 'faq')) issues.push('FAQセクションがなく離脱リスクが高い');
  if (!doc.blocks.some((b) => b.type === 'cta')) issues.push('記事中CTAがありません');
  if (doc.disclaimers.length === 0) issues.push('打消し表示がありません');
  if (doc.title.length > 45) issues.push(`タイトルが長い（${doc.title.length}文字）`);
  return { checkedAt: new Date().toISOString(), chars: text.length, issues, passed: issues.length === 0 };
}

function categoryDisclaimers(category: string): string[] {
  switch (category) {
    case 'cosmetics':
    case 'quasi_drug':
      return ['化粧品の効能効果の範囲内で表現しています。', '肌に異常が生じた場合は使用を中止し、医師にご相談ください。'];
    case 'supplement':
    case 'food_with_claims':
      return ['本品は食品であり、医薬品ではありません。疾病の診断・治療・予防を目的としたものではありません。', 'バランスの取れた食生活を心がけてください。'];
    case 'medical_device':
      return ['医療機器としての承認範囲内で表現しています。使用前に添付文書をご確認ください。'];
    default:
      return [];
  }
}

function fallbackBlocks(brief: Brief, sections: string[]): LpBlock[] {
  const blocks: LpBlock[] = [
    { type: 'lead', text: `${brief.target ?? 'こんな方'}に向けて、${brief.product ?? '本商品'}の選び方を整理しました。` },
  ];
  for (const section of sections) {
    blocks.push({ type: 'heading', text: section });
    blocks.push({ type: 'paragraph', text: `${section}について、押さえておきたい点をまとめます。` });
  }
  blocks.push({ type: 'list', items: brief.usp ?? ['ポイント1', 'ポイント2', 'ポイント3'] });
  blocks.push({ type: 'faq', items: [{ q: 'どのくらいで届きますか？', a: 'ご注文から通常3〜5営業日でお届けします。' }] });
  blocks.push({ type: 'cta', label: brief.cta ?? '公式サイトを見る', url: brief.landingUrl ?? '#cta', note: brief.offer ?? '' });
  return blocks;
}
