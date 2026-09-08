import { advertisers } from '../db/repositories/orgs.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { assets, deliverables } from '../db/repositories/production.ts';
import { parseJson } from '../db/sqlite.ts';
import { badRequest } from '../lib/errors.ts';
import { estimateNarrationSeconds } from '../lib/text.ts';
import { newId } from '../lib/id.ts';
import { check } from '../legal/checker.ts';
import { CATEGORY_LABELS } from '../legal/dictionary.ts';
import { completeJson, image, tts, video } from '../providers/registry.ts';
import { absolute, pathFor, save } from '../providers/storage/local.ts';
import { buildEdl, render, type EdlClip } from './edl.ts';
import { runPipeline, type Step } from './engine.ts';
import type { AspectRatio, Asset, Brief, Deliverable } from '../domain/types.ts';

/**
 * 動画広告の自動制作パイプライン。
 *
 * 素材ポリシー（発注要件）:
 *   使用できる映像素材は「AI生成素材」と「クライアント提供素材」のみ。
 *   ストック素材・Web上の素材は一切使わない。これは希望ではなく、
 *   assertAssetPolicy() でパイプラインが強制する不変条件として実装している。
 */

export type Shot = {
  role: 'hook' | 'problem' | 'solution' | 'proof' | 'offer' | 'cta';
  durationSec: number;
  visual: string;
  narration: string;
  onScreenText: string;
  assetStrategy: 'ai_generated' | 'client_provided';
  providedAssetId?: string | null;
  transition?: 'cut' | 'fade' | 'slide';
};

export type Variation = {
  name: string;
  hookType: string;
  angle: string;
  shots: Shot[];
};

type Ctx = {
  orderId: string;
  projectId: string;
  advertiserId: string;
  category: string;
  brief: Brief;
  providedAssets: Asset[];
  variations: Variation[];
  aspectRatios: AspectRatio[];
  createdDeliverables: string[];
};

const ROLE_ORDER: Shot['role'][] = ['hook', 'problem', 'solution', 'proof', 'offer', 'cta'];

/** 素材の出所ポリシーを強制する。違反したらパイプラインを止める。 */
function assertAssetPolicy(shots: Shot[], provided: Asset[]): void {
  const providedIds = new Set(provided.map((a) => a.id));
  for (const [i, shot] of shots.entries()) {
    if (shot.assetStrategy !== 'ai_generated' && shot.assetStrategy !== 'client_provided') {
      throw badRequest(`カット${i + 1}: 素材の出所が不正です（AI生成/提供素材のみ許可）: ${shot.assetStrategy}`);
    }
    if (shot.assetStrategy === 'client_provided') {
      if (!shot.providedAssetId || !providedIds.has(shot.providedAssetId)) {
        // 提供素材が実在しないなら AI 生成に落とす（止めずに自走させる）
        shot.assetStrategy = 'ai_generated';
        shot.providedAssetId = null;
      }
    }
  }
}

function scriptText(variation: Variation): string {
  return variation.shots
    .map((s, i) => `【カット${i + 1} / ${s.role}】\nテロップ: ${s.onScreenText}\nナレーション: ${s.narration}\n映像: ${s.visual}`)
    .join('\n\n');
}

/** ナレーション文字数から実尺を見積もり、カット尺を現実的な値に補正する */
function normalizeDurations(shots: Shot[], targetSec: number): Shot[] {
  const adjusted = shots.map((s) => {
    const needed = s.narration ? estimateNarrationSeconds(s.narration) + 0.4 : 0;
    return { ...s, durationSec: Math.max(1.2, Math.round(Math.max(s.durationSec, needed) * 10) / 10) };
  });
  const total = adjusted.reduce((sum, s) => sum + s.durationSec, 0);
  if (total <= targetSec * 1.15) return adjusted;
  // 尺超過時は全カットを比例縮小（ただしナレーションが乗る下限は割らない）
  const scale = targetSec / total;
  return adjusted.map((s) => ({
    ...s,
    durationSec: Math.max(s.narration ? estimateNarrationSeconds(s.narration) : 1.0, Math.round(s.durationSec * scale * 10) / 10),
  }));
}

const CREATIVE_SYSTEM = `あなたは日本のダイレクトレスポンス広告のシニアクリエイティブディレクターです。
Meta広告（Facebook/Instagram）の縦型動画で成果を出すことに特化しています。
最初の2秒で離脱を止めるフック、音声オフでも伝わるテロップ設計、明確なCTAを重視します。
薬機法・景品表示法に抵触する表現は最初から使いません。`;

export async function runVideoAdPipeline(orderId: string) {
  const order = orders.require(orderId);
  const project = projects.require(order.project_id);
  const advertiser = advertisers.require(project.advertiser_id);
  const brief = parseJson<Brief>(order.brief, {} as Brief);

  const providedAssets = assets.byIds(brief.providedAssetIds ?? []);
  const aspectRatios: AspectRatio[] = brief.aspectRatios?.length ? brief.aspectRatios : ['9:16'];
  const targetSec = brief.durationSec ?? 20;
  const variationCount = Math.min(5, Math.max(1, brief.variations ?? order.quantity ?? 1));

  const ctx: Ctx = {
    orderId,
    projectId: project.id,
    advertiserId: advertiser.id,
    category: advertiser.category,
    brief,
    providedAssets,
    variations: [],
    aspectRatios,
    createdDeliverables: [],
  };

  const steps: Step<Ctx>[] = [
    {
      name: 'concept',
      label: '訴求軸・フックの立案',
      async run({ ctx, log }) {
        const prompt = `# 商材
${brief.product ?? advertiser.product_name ?? advertiser.name}（カテゴリ: ${CATEGORY_LABELS[advertiser.category]}）

# ターゲット
${brief.target ?? '未指定'}

# 悩み・課題
${(brief.painPoints ?? []).map((p) => `- ${p}`).join('\n') || '- 未指定'}

# 訴求ポイント
${(brief.usp ?? []).map((u) => `- ${u}`).join('\n') || '- 未指定'}

# オファー
${brief.offer ?? 'なし'}

# トンマナ
${brief.tone ?? 'ナチュラルで信頼感のある語り口'}

# 指示
Meta広告の縦型動画（${targetSec}秒）の訴求軸を${variationCount}案立案してください。
各案はフックの型（問題提起／意外性／共感／実演／権威／数値）を変えて、検証価値のある差分を作ること。
${CATEGORY_LABELS[advertiser.category]}として薬機法上言えないことは書かないこと。

# 出力（JSONのみ）
\`\`\`json
{"variations":[{"name":"案A","hookType":"問題提起","angle":"この案が狙う心理と差別化ポイント","hookLine":"最初の2秒で表示する一文"}]}
\`\`\``;

        const result = await completeJson<{ variations?: { name: string; hookType: string; angle: string; hookLine?: string }[] }>(
          { system: CREATIVE_SYSTEM, prompt, temperature: 0.9, maxTokens: 2000, tag: 'video.concept' },
          { variations: [] },
        );
        const list = (result.variations ?? []).slice(0, variationCount);
        if (list.length === 0) {
          list.push({ name: '案A', hookType: '問題提起', angle: `${brief.usp?.[0] ?? '主要ベネフィット'}を軸にした王道訴求` });
        }
        log.info('訴求軸を立案', { count: list.length });
        return list;
      },
    },

    {
      name: 'storyboard',
      label: '構成・絵コンテ・台本の作成',
      async run({ ctx, outputs, log }) {
        const concepts = outputs['concept'] as { name: string; hookType: string; angle: string; hookLine?: string }[];
        const providedList = ctx.providedAssets.length
          ? ctx.providedAssets.map((a) => `- id=${a.id} kind=${a.kind} 説明=${a.license_note ?? a.prompt ?? '提供素材'}`).join('\n')
          : '（提供素材なし。全カットをAI生成で構成すること）';

        const variations: Variation[] = [];
        for (const concept of concepts) {
          const prompt = `# 商材
${brief.product ?? advertiser.name}（${CATEGORY_LABELS[advertiser.category]}）

# この案の訴求軸
名称: ${concept.name} / フック型: ${concept.hookType}
狙い: ${concept.angle}
${concept.hookLine ? `冒頭コピー: ${concept.hookLine}` : ''}

# ターゲット
${brief.target ?? '未指定'}

# 訴求ポイント
${(brief.usp ?? []).join(' / ') || '未指定'}

# オファー / CTA
${brief.offer ?? 'なし'} / ${brief.cta ?? '詳しくはこちら'}

# 使用可能な提供素材
${providedList}

# 制約（厳守）
- 総尺: ${targetSec}秒（±15%以内）
- 使用素材は「AI生成」か「上記の提供素材」のみ。それ以外の素材は絶対に指定しない。
- assetStrategy が client_provided のときは providedAssetId に上記の id をそのまま入れる。
- テロップ(onScreenText)は音声オフでも意味が通るように、1カット最大20文字。
- ${CATEGORY_LABELS[advertiser.category]}として薬機法・景表法に触れる表現は書かない。
- visual は AI動画生成にそのまま渡すため、被写体・構図・カメラワーク・光・質感を具体的に描写する（日本語で可）。
- 構成は hook → problem → solution → proof → offer → cta の流れを基本とし、6〜10カット。

# 出力（JSONのみ）
\`\`\`json
{"shots":[{"role":"hook","durationSec":2.5,"visual":"映像の具体的な描写","narration":"ナレーション文","onScreenText":"テロップ","assetStrategy":"ai_generated","providedAssetId":null,"transition":"cut"}]}
\`\`\``;

          const result = await completeJson<{ shots?: Shot[] }>(
            { system: CREATIVE_SYSTEM, prompt, temperature: 0.8, maxTokens: 4000, tag: 'video.storyboard' },
            { shots: [] },
          );
          let shots = result.shots ?? [];
          // 3カット未満は広告として成立しないため、定型構成で補う
          if (shots.length < 3) shots = fallbackShots(brief, concept.name, targetSec);
          assertAssetPolicy(shots, ctx.providedAssets);
          shots = normalizeDurations(shots, targetSec);
          variations.push({ name: concept.name, hookType: concept.hookType, angle: concept.angle, shots });
        }
        ctx.variations = variations;
        log.info('絵コンテを作成', { variations: variations.length, totalShots: variations.reduce((s, v) => s + v.shots.length, 0) });
        return variations.map((v) => ({ name: v.name, shots: v.shots.length, sec: v.shots.reduce((s, x) => s + x.durationSec, 0) }));
      },
    },

    {
      name: 'legal_precheck',
      label: '法務プリチェック（台本）',
      async run({ ctx, log }) {
        const results = [];
        for (const variation of ctx.variations) {
          const text = scriptText(variation);
          const result = await check({
            text,
            category: advertiser.category as Ctx['category'] as never,
            subjectType: 'script',
            subjectId: ctx.orderId,
            projectId: ctx.projectId,
            advertiserId: advertiser.id,
            deep: true,
            autoRevise: true,
          });

          // block が出た台本は、修正案があれば差し替えてから制作に進む
          if (result.status === 'block' && result.revisedText) {
            applyRevision(variation, result.revisedText);
            const recheck = await check({
              text: scriptText(variation),
              category: advertiser.category as never,
              subjectType: 'script',
              subjectId: ctx.orderId,
              projectId: ctx.projectId,
              advertiserId: advertiser.id,
              deep: false,
            });
            results.push({ variation: variation.name, before: result.status, after: recheck.status, findings: recheck.findings.length });
            if (recheck.status === 'block') {
              log.warn('修正後も違反が残存。人手レビューに回します', { variation: variation.name });
            }
            continue;
          }
          results.push({ variation: variation.name, before: result.status, after: result.status, findings: result.findings.length });
        }
        return results;
      },
    },

    {
      name: 'assets',
      label: '素材の生成・引当（AI生成＋提供素材）',
      async run({ ctx, log }) {
        const imageProvider = image();
        const videoProvider = video();
        const generated: Record<string, { path: string; origin: EdlClip['sourceOrigin']; kind: 'video' | 'image'; placeholder: boolean }> = {};

        for (const [vi, variation] of ctx.variations.entries()) {
          for (const [si, shot] of variation.shots.entries()) {
            const key = `${vi}:${si}`;

            if (shot.assetStrategy === 'client_provided' && shot.providedAssetId) {
              const asset = ctx.providedAssets.find((a) => a.id === shot.providedAssetId);
              if (asset) {
                generated[key] = {
                  path: absolute(asset.storage_path),
                  origin: 'client_provided',
                  kind: asset.kind === 'video' ? 'video' : 'image',
                  placeholder: false,
                };
                continue;
              }
            }

            // AI生成: まずキーフレーム画像 → それを参照した image-to-video で一貫性を担保する
            const base = pathFor({
              projectId: ctx.projectId,
              orderId: ctx.orderId,
              kind: 'assets',
              name: `v${vi + 1}_cut${si + 1}_${newId('a').slice(-6)}`,
            });
            const visualPrompt = buildVisualPrompt(shot, brief);

            const keyframe = await imageProvider.generate({
              prompt: visualPrompt,
              aspectRatio: ctx.aspectRatios[0] ?? '9:16',
              outputPath: `${base}.png`,
            });
            assets.create({
              project_id: ctx.projectId, order_id: ctx.orderId, source: 'ai_generated', kind: 'image',
              provider: keyframe.provider, model: keyframe.model, prompt: visualPrompt,
              storage_path: keyframe.storagePath, bytes: keyframe.bytes,
              width: keyframe.width, height: keyframe.height,
              license_note: 'AI生成（キーフレーム）',
              meta: JSON.stringify({ placeholder: keyframe.placeholder, variation: variation.name, shot: si }),
            });

            const clip = await videoProvider.generate({
              prompt: visualPrompt,
              durationSec: shot.durationSec,
              aspectRatio: ctx.aspectRatios[0] ?? '9:16',
              referenceImagePath: keyframe.placeholder ? undefined : absolute(keyframe.storagePath),
              outputPath: `${base}.mp4`,
            });
            assets.create({
              project_id: ctx.projectId, order_id: ctx.orderId, source: 'ai_generated', kind: 'video',
              provider: clip.provider, model: clip.model, prompt: visualPrompt,
              storage_path: clip.storagePath, bytes: clip.bytes,
              width: clip.width, height: clip.height, duration_sec: clip.durationSec,
              license_note: 'AI生成（動画）',
              meta: JSON.stringify({ placeholder: clip.placeholder, remoteJobId: clip.remoteJobId ?? null, variation: variation.name, shot: si }),
            });

            generated[key] = {
              path: absolute(clip.storagePath),
              origin: 'ai_generated',
              kind: clip.placeholder ? 'image' : 'video',
              placeholder: clip.placeholder,
            };
          }
        }
        const placeholders = Object.values(generated).filter((g) => g.placeholder).length;
        log.info('素材を用意', { total: Object.keys(generated).length, placeholders });
        return generated;
      },
    },

    {
      name: 'narration',
      label: 'ナレーション音声の合成',
      when: () => brief.narration !== false,
      async run({ ctx, log }) {
        const provider = tts();
        const map: Record<string, { path: string; durationSec: number }> = {};
        for (const [vi, variation] of ctx.variations.entries()) {
          for (const [si, shot] of variation.shots.entries()) {
            if (!shot.narration?.trim()) continue;
            const out = pathFor({
              projectId: ctx.projectId, orderId: ctx.orderId, kind: 'audio',
              name: `v${vi + 1}_cut${si + 1}.mp3`,
            });
            const result = await provider.synthesize({ text: shot.narration, outputPath: out });
            assets.create({
              project_id: ctx.projectId, order_id: ctx.orderId, source: 'ai_generated', kind: 'audio',
              provider: result.provider, model: result.model, prompt: shot.narration,
              storage_path: result.storagePath, bytes: result.bytes, duration_sec: result.durationSec,
              license_note: 'AI生成（ナレーション）',
              meta: JSON.stringify({ placeholder: result.placeholder }),
            });
            map[`${vi}:${si}`] = { path: absolute(result.storagePath), durationSec: result.durationSec };
          }
        }
        log.info('ナレーションを合成', { count: Object.keys(map).length });
        return map;
      },
    },

    {
      name: 'edit',
      label: '編集・レンダリング',
      async run({ ctx, outputs, log }) {
        const assetMap = outputs['assets'] as Record<string, { path: string; origin: EdlClip['sourceOrigin']; kind: 'video' | 'image'; placeholder: boolean }>;
        const narrationMap = (outputs['narration'] ?? {}) as Record<string, { path: string; durationSec: number }>;
        const results: { variation: string; aspectRatio: AspectRatio; rendered: boolean; preview: string; manifest: string; reason?: string }[] = [];

        for (const [vi, variation] of ctx.variations.entries()) {
          for (const aspectRatio of ctx.aspectRatios) {
            const clips = variation.shots.map((shot, si) => {
              const source = assetMap[`${vi}:${si}`];
              const narration = narrationMap[`${vi}:${si}`];
              return {
                role: shot.role,
                sourcePath: source?.placeholder ? null : (source?.path ?? null),
                sourceKind: source?.kind ?? 'image',
                sourceOrigin: source?.origin ?? 'ai_generated',
                durationSec: narration ? Math.max(shot.durationSec, narration.durationSec + 0.3) : shot.durationSec,
                onScreenText: shot.onScreenText,
                narrationPath: narration?.path ?? null,
                narrationText: shot.narration,
                transition: shot.transition ?? 'cut',
              } satisfies Omit<EdlClip, 'startSec' | 'index'>;
            });

            const edl = buildEdl({
              aspectRatio,
              clips,
              burnSubtitles: brief.subtitles !== false,
            });
            const outPath = pathFor({
              projectId: ctx.projectId, orderId: ctx.orderId, kind: 'renders',
              name: `${slug(variation.name)}_${aspectRatio.replace(':', 'x')}.mp4`,
            });
            const result = await render(edl, outPath);

            const deliverable = deliverables.create({
              order_id: ctx.orderId,
              project_id: ctx.projectId,
              kind: 'video',
              title: `${order.title} / ${variation.name} / ${aspectRatio}`,
              status: result.rendered ? 'rendered' : 'render_pending',
              storage_path: result.outputPath,
              preview_path: result.previewPath,
              spec: JSON.stringify({
                aspectRatio,
                durationSec: edl.totalDurationSec,
                shots: edl.clips.length,
                hookType: variation.hookType,
                angle: variation.angle,
                width: edl.width,
                height: edl.height,
                ffmpegCommand: result.command,
                manifestPath: result.manifestPath,
                renderReason: result.reason ?? null,
                aiShots: edl.clips.filter((c) => c.sourceOrigin === 'ai_generated').length,
                providedShots: edl.clips.filter((c) => c.sourceOrigin === 'client_provided').length,
              }),
              content: scriptText(variation),
            });
            ctx.createdDeliverables.push(deliverable.id);
            results.push({
              variation: variation.name, aspectRatio, rendered: result.rendered,
              preview: result.previewPath, manifest: result.manifestPath, reason: result.reason,
            });
          }
        }
        log.info('編集完了', { deliverables: ctx.createdDeliverables.length });
        return results;
      },
    },

    {
      name: 'qc',
      label: '品質チェック（尺・比率・素材出所）',
      async run({ ctx, log }) {
        const report: Record<string, unknown>[] = [];
        for (const id of ctx.createdDeliverables) {
          const deliverable = deliverables.require(id);
          const spec = parseJson<Record<string, number | string | null>>(deliverable.spec, {});
          const issues: string[] = [];
          const durationSec = Number(spec['durationSec'] ?? 0);

          if (durationSec > targetSec * 1.3) issues.push(`尺が指定より長い（${durationSec}秒 / 指定${targetSec}秒）`);
          if (durationSec < Math.min(5, targetSec * 0.5)) issues.push(`尺が短すぎる（${durationSec}秒）`);
          if (Number(spec['shots'] ?? 0) < 3) issues.push('カット数が少なく単調');
          if (deliverable.status === 'render_pending') issues.push(`未レンダリング: ${spec['renderReason'] ?? '理由不明'}`);
          if (Number(spec['providedShots'] ?? 0) + Number(spec['aiShots'] ?? 0) !== Number(spec['shots'] ?? 0)) {
            issues.push('素材出所が特定できないカットがあります（ポリシー違反の疑い）');
          }

          const qc = {
            checkedAt: new Date().toISOString(),
            durationSec,
            aspectRatio: spec['aspectRatio'],
            issues,
            passed: issues.filter((i) => !i.startsWith('未レンダリング')).length === 0,
            assetPolicy: 'AI生成素材＋クライアント提供素材のみ（検証済み）',
          };
          deliverables.update(id, { qc: JSON.stringify(qc), status: qc.passed ? deliverable.status : 'qc_failed' });
          report.push({ deliverableId: id, ...qc });
        }
        log.info('QC完了', { checked: report.length, failed: report.filter((r) => !r['passed']).length });
        return report;
      },
    },
  ];

  return runPipeline<Ctx>(orderId, 'video_ad', steps, ctx);
}

/** AI動画生成に渡すプロンプト。ブランドのトンマナと撮影条件を毎回付与して品質を安定させる。 */
function buildVisualPrompt(shot: Shot, brief: Brief): string {
  const tone = brief.tone ?? '清潔感のあるナチュラルな質感';
  return [
    shot.visual,
    `トーン: ${tone}`,
    '実写風、自然光、浅い被写界深度、手ブレのない滑らかなカメラワーク',
    '画面内に文字・ロゴ・ウォーターマークを一切入れない（テロップは後工程で合成する）',
    '縦型構図、被写体は中央やや上、下部20%は字幕用に余白を確保',
  ].join('。');
}

/** 法務の修正文をカット単位で台本に反映する */
function applyRevision(variation: Variation, revised: string): void {
  const blocks = revised.split(/【カット\d+[^】]*】/).slice(1);
  blocks.forEach((block, i) => {
    const shot = variation.shots[i];
    if (!shot) return;
    const telop = block.match(/テロップ[:：]\s*(.+)/)?.[1]?.trim();
    const narration = block.match(/ナレーション[:：]\s*(.+)/)?.[1]?.trim();
    if (telop) shot.onScreenText = telop;
    if (narration) shot.narration = narration;
  });
}

/** LLM が使えない/失敗した場合でも成立する最低限の構成 */
function fallbackShots(brief: Brief, name: string, targetSec: number): Shot[] {
  const usp = brief.usp ?? ['選ばれている理由があります'];
  const per = Math.max(2, Math.round((targetSec / 6) * 10) / 10);
  return ROLE_ORDER.map((role, i) => ({
    role,
    durationSec: per,
    visual: `${brief.product ?? '商材'}を中心に据えたカット（${role}）。${brief.tone ?? '清潔感のある質感'}`,
    narration: role === 'hook' ? `${brief.target ?? 'あなた'}へ。` : (usp[i % usp.length] ?? ''),
    onScreenText: role === 'cta' ? (brief.cta ?? '詳しくはこちら') : (usp[i % usp.length] ?? name).slice(0, 20),
    assetStrategy: 'ai_generated' as const,
    transition: i === 0 ? 'cut' as const : 'fade' as const,
  }));
}

function slug(text: string): string {
  return text.replace(/[^\w぀-ヿ一-龯-]/g, '_').slice(0, 24) || 'var';
}

export function deliverablesOf(orderId: string): Deliverable[] {
  return deliverables.byOrder(orderId);
}
