import { advertisers } from '../db/repositories/orgs.ts';
import { metaAccounts, metaObjects } from '../db/repositories/meta.ts';
import { deliverables } from '../db/repositories/production.ts';
import { orders, projects } from '../db/repositories/projects.ts';
import { events } from '../db/repositories/system.ts';
import { parseJson } from '../db/sqlite.ts';
import { config } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { completeJson } from '../providers/registry.ts';
import { absolute, publicUrl } from '../providers/storage/local.ts';
import { check } from '../legal/checker.ts';
import { jstDateString } from '../lib/date.ts';
import {
  createAd, createAdSet, createCampaign, createCreative, defaultTargeting,
  isSandbox, uploadImage, uploadVideo,
} from './client.ts';
import type { Brief, Deliverable, Project } from '../domain/types.ts';

const log = createLogger('meta:publish');

/**
 * 承認済みクリエイティブを Meta へ入稿する。
 *
 * 構成方針:
 *   1キャンペーン（案件） → 1広告セット（訴求軸ごと） → 1広告（クリエイティブごと）
 *   新規クリエイティブは必ず PAUSED で作成し、法務ステータスが pass のものだけを ACTIVE にする。
 */

export type PublishResult = {
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  sandbox: boolean;
  skipped: { deliverableId: string; reason: string }[];
};

/** 案件のキャンペーンを取得（なければ作成） */
async function ensureCampaign(project: Project, adAccountId: string): Promise<string> {
  const existing = metaObjects.list(project.id, 'campaign')[0];
  if (existing) return existing.id;

  const objective = project.objective === 'leads' ? 'OUTCOME_LEADS'
    : project.objective === 'traffic' ? 'OUTCOME_TRAFFIC'
    : 'OUTCOME_SALES';

  const remote = await createCampaign({
    adAccountId,
    name: `${project.name} | ${jstDateString()}`,
    objective,
    status: 'PAUSED',
  });

  const local = metaObjects.create({
    project_id: project.id,
    level: 'campaign',
    remote_id: remote.id,
    name: `${project.name} | ${jstDateString()}`,
    status: 'PAUSED',
    config: JSON.stringify({ objective, adAccountId }),
  });
  log.info('キャンペーンを作成', { projectId: project.id, remoteId: remote.id });
  return local.id;
}

/** 広告文（プライマリテキスト・見出し）を生成し、法務チェックを通す */
async function generateAdCopy(
  project: Project,
  deliverable: Deliverable,
  brief: Brief,
): Promise<{ message: string; headline: string; description: string; legalStatus: string }> {
  const advertiser = advertisers.require(project.advertiser_id);
  const prompt = `# 商材
${brief.product ?? advertiser.name}

# クリエイティブ
${deliverable.title}
${(deliverable.content ?? '').slice(0, 1500)}

# 訴求ポイント
${(brief.usp ?? []).join(' / ')}

# オファー
${brief.offer ?? 'なし'}

# 指示
Meta広告の広告文を作成してください。
- message（プライマリテキスト）: 90文字以内。1行目で興味を引く
- headline（見出し）: 25文字以内
- description（説明）: 30文字以内
- 薬機法・景表法に違反しない表現のみ

# 出力（JSONのみ）
\`\`\`json
{"message":"","headline":"","description":""}
\`\`\``;

  const copy = await completeJson<{ message?: string; headline?: string; description?: string }>(
    { prompt, temperature: 0.8, maxTokens: 800, tag: 'meta.adcopy' },
    {},
  );
  const message = copy.message ?? `${brief.product ?? advertiser.name}${brief.offer ? `｜${brief.offer}` : ''}`;
  const headline = copy.headline ?? (brief.usp ?? [])[0]?.slice(0, 25) ?? advertiser.name;
  const description = copy.description ?? brief.cta ?? '詳しくはこちら';

  const review = await check({
    text: [message, headline, description].join('\n'),
    category: advertiser.category,
    subjectType: 'ad_copy',
    subjectId: deliverable.id,
    projectId: project.id,
    advertiserId: advertiser.id,
    deep: true,
    autoRevise: true,
  });

  if (review.status === 'block' && review.revisedText) {
    const lines = review.revisedText.split('\n').filter(Boolean);
    return {
      message: lines[0] ?? message,
      headline: lines[1] ?? headline,
      description: lines[2] ?? description,
      legalStatus: 'revised',
    };
  }
  return { message, headline, description, legalStatus: review.status };
}

export async function publishOrderCreatives(orderId: string): Promise<PublishResult> {
  const order = orders.require(orderId);
  const project = projects.require(order.project_id);
  const account = metaAccounts.byProject(project.id) ?? {
    id: 'default',
    project_id: project.id,
    ad_account_id: config.meta.defaultAdAccountId,
    page_id: config.meta.defaultPageId,
    pixel_id: config.meta.defaultPixelId,
    instagram_id: null,
    token_ref: 'env',
    status: 'active',
  };
  const brief = parseJson<Brief>(order.brief, {} as Brief);
  const list = deliverables.byOrder(orderId);
  const skipped: { deliverableId: string; reason: string }[] = [];

  const campaignLocalId = await ensureCampaign(project, account.ad_account_id);
  const campaign = metaObjects.require(campaignLocalId);

  // 訴求軸（発注単位）で広告セットを1つ作る
  const dailyBudget = Math.max(1000, brief.dailyBudget ?? project.daily_budget ?? Math.floor(project.monthly_budget / 30));
  const adSetRemote = await createAdSet({
    adAccountId: account.ad_account_id,
    campaignId: campaign.remote_id ?? campaign.id,
    name: `${order.title} | ${jstDateString()}`,
    dailyBudget,
    optimizationGoal: project.objective === 'traffic' ? 'LINK_CLICKS' : 'OFFSITE_CONVERSIONS',
    pixelId: account.pixel_id ?? undefined,
    customEventType: project.objective === 'leads' ? 'LEAD' : 'PURCHASE',
    targeting: defaultTargeting(brief.audiences?.length ? { flexible_spec: [{ interests: brief.audiences.map((a) => ({ name: a })) }] } : {}),
    status: 'PAUSED',
  });
  const adSet = metaObjects.create({
    project_id: project.id,
    level: 'adset',
    remote_id: adSetRemote.id,
    parent_id: campaign.id,
    name: `${order.title} | ${jstDateString()}`,
    status: 'PAUSED',
    daily_budget: dailyBudget,
    config: JSON.stringify({ orderId, optimizationGoal: project.objective }),
  });

  const adIds: string[] = [];
  for (const deliverable of list) {
    if (deliverable.legal_status === 'block') {
      skipped.push({ deliverableId: deliverable.id, reason: '法務チェックで block 判定のため入稿しません' });
      continue;
    }
    if (deliverable.kind !== 'video' && deliverable.kind !== 'lp' && deliverable.kind !== 'article_lp') {
      skipped.push({ deliverableId: deliverable.id, reason: '入稿対象外の納品物' });
      continue;
    }

    const copy = await generateAdCopy(project, deliverable, brief);
    const linkUrl = deliverable.kind === 'video'
      ? (brief.landingUrl ?? publicUrl(deliverable.storage_path ?? ''))
      : publicUrl(deliverable.storage_path ?? '');

    let videoId: string | undefined;
    let imageHash: string | undefined;
    if (deliverable.kind === 'video') {
      const absPath = deliverable.storage_path ? absolute(deliverable.storage_path) : null;
      const uploaded = await uploadVideo(account.ad_account_id, absPath, `${deliverable.title}.mp4`);
      videoId = uploaded.id;
      if (!absPath) {
        skipped.push({ deliverableId: deliverable.id, reason: '未レンダリングのためサンドボックス入稿（実配信されません）' });
      }
    } else {
      const uploaded = await uploadImage(account.ad_account_id, null, `${deliverable.title}.png`);
      imageHash = uploaded.hash;
    }

    const creativeRemote = await createCreative({
      adAccountId: account.ad_account_id,
      name: `CR ${deliverable.title}`,
      pageId: account.page_id ?? config.meta.defaultPageId,
      instagramActorId: account.instagram_id ?? undefined,
      message: copy.message,
      headline: copy.headline,
      description: copy.description,
      linkUrl,
      callToActionType: project.objective === 'leads' ? 'SIGN_UP' : 'SHOP_NOW',
      videoId,
      imageHash,
    });
    const creative = metaObjects.create({
      project_id: project.id,
      level: 'creative',
      remote_id: creativeRemote.id,
      parent_id: adSet.id,
      name: `CR ${deliverable.title}`,
      status: 'ACTIVE',
      deliverable_id: deliverable.id,
      config: JSON.stringify({ ...copy, linkUrl, videoId, imageHash }),
    });

    const adRemote = await createAd({
      adAccountId: account.ad_account_id,
      adSetId: adSet.remote_id ?? adSet.id,
      creativeId: creativeRemote.id,
      name: deliverable.title,
      status: 'PAUSED',   // 配信開始は運用側の判断（承認 or オートパイロット）で行う
    });
    const ad = metaObjects.create({
      project_id: project.id,
      level: 'ad',
      remote_id: adRemote.id,
      parent_id: adSet.id,
      name: deliverable.title,
      status: 'PAUSED',
      deliverable_id: deliverable.id,
      config: JSON.stringify({ creativeLocalId: creative.id, legalStatus: copy.legalStatus }),
    });
    adIds.push(ad.id);
    deliverables.update(deliverable.id, { status: 'published' });
  }

  events.log('system', 'meta.published', 'order', orderId, {
    campaignId: campaign.id, adSetId: adSet.id, ads: adIds.length, sandbox: isSandbox(),
  });
  log.info('Meta入稿完了', { orderId, ads: adIds.length, skipped: skipped.length, sandbox: isSandbox() });

  return { campaignId: campaign.id, adSetIds: [adSet.id], adIds, sandbox: isSandbox(), skipped };
}

/** 配信開始（キャンペーン・広告セット・広告をまとめて ACTIVE にする） */
export async function activate(projectId: string, objectIds?: string[]): Promise<number> {
  const targets = objectIds?.length
    ? objectIds.map((id) => metaObjects.require(id))
    : metaObjects.list(projectId).filter((o) => o.level !== 'creative');

  let count = 0;
  for (const object of targets) {
    if (object.status === 'ACTIVE') continue;
    if (object.level === 'ad') {
      const deliverable = object.deliverable_id ? deliverables.find(object.deliverable_id) : null;
      if (deliverable && deliverable.legal_status === 'block') continue;
    }
    const { updateObject } = await import('./client.ts');
    await updateObject(object.remote_id ?? object.id, { status: 'ACTIVE' });
    metaObjects.update(object.id, { status: 'ACTIVE' });
    count++;
  }
  events.log('system', 'meta.activated', 'project', projectId, { count });
  return count;
}
