import { readFileSync } from 'node:fs';
import { config } from '../config/env.ts';
import { request } from '../lib/http.ts';
import { createLogger } from '../lib/logger.ts';
import { upstream } from '../lib/errors.ts';
import { newId } from '../lib/id.ts';

const log = createLogger('meta');

/**
 * Meta Marketing API クライアント。
 *
 * META_ENABLED=false のときはサンドボックスとして動作し、
 * 実在しないリモートIDを払い出す。これにより実アカウントに触れずに
 * 「入稿→配信→数値取得→最適化」のループ全体を検証できる。
 */
export type GraphParams = Record<string, string | number | boolean | undefined>;

function baseUrl(): string {
  return `https://graph.facebook.com/${config.meta.apiVersion}`;
}

function token(): string {
  if (!config.meta.token) throw upstream('META_SYSTEM_USER_TOKEN が未設定です');
  return config.meta.token;
}

export const isSandbox = (): boolean => !config.meta.enabled || !config.meta.token;

function sandboxId(prefix: string): string {
  return `sbx_${prefix}_${newId('x').slice(-12)}`;
}

export async function graphGet<T>(path: string, params: GraphParams = {}): Promise<T> {
  const url = new URL(`${baseUrl()}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', token());
  return request<T>(url.toString(), { timeoutMs: 120_000, retries: 3 });
}

export async function graphPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${baseUrl()}/${path.replace(/^\//, '')}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  form.set('access_token', token());
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    timeoutMs: 180_000,
  });
}

// ---------------- キャンペーン階層 ----------------

export type CreateCampaignInput = {
  adAccountId: string;
  name: string;
  objective: string;          // OUTCOME_SALES / OUTCOME_LEADS / OUTCOME_TRAFFIC ...
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: number;       // CBO を使う場合
  bidStrategy?: string;
  specialAdCategories?: string[];
};

export async function createCampaign(input: CreateCampaignInput): Promise<{ id: string }> {
  if (isSandbox()) {
    log.info('[sandbox] キャンペーン作成', { name: input.name });
    return { id: sandboxId('camp') };
  }
  return graphPost(`${input.adAccountId}/campaigns`, {
    name: input.name,
    objective: input.objective,
    status: input.status ?? 'PAUSED',
    special_ad_categories: input.specialAdCategories ?? [],
    ...(input.dailyBudget ? { daily_budget: input.dailyBudget, bid_strategy: input.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP' } : {}),
  });
}

export type CreateAdSetInput = {
  adAccountId: string;
  campaignId: string;
  name: string;
  dailyBudget: number;
  optimizationGoal?: string;   // OFFSITE_CONVERSIONS / LINK_CLICKS ...
  billingEvent?: string;
  pixelId?: string;
  customEventType?: string;    // PURCHASE / LEAD ...
  targeting?: Record<string, unknown>;
  startTime?: string;
  status?: 'ACTIVE' | 'PAUSED';
  bidAmount?: number;
};

/** 日本向けの既定ターゲティング。年齢・地域・配置は案件側で上書きする。 */
export function defaultTargeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    geo_locations: { countries: ['JP'] },
    age_min: 20,
    age_max: 65,
    targeting_automation: { advantage_audience: 1 },
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'video_feeds', 'story', 'facebook_reels'],
    instagram_positions: ['stream', 'story', 'reels', 'explore'],
    ...overrides,
  };
}

export async function createAdSet(input: CreateAdSetInput): Promise<{ id: string }> {
  if (isSandbox()) {
    log.info('[sandbox] 広告セット作成', { name: input.name, dailyBudget: input.dailyBudget });
    return { id: sandboxId('adset') };
  }
  return graphPost(`${input.adAccountId}/adsets`, {
    name: input.name,
    campaign_id: input.campaignId,
    daily_budget: input.dailyBudget,
    billing_event: input.billingEvent ?? 'IMPRESSIONS',
    optimization_goal: input.optimizationGoal ?? 'OFFSITE_CONVERSIONS',
    bid_strategy: input.bidAmount ? 'COST_CAP' : 'LOWEST_COST_WITHOUT_CAP',
    ...(input.bidAmount ? { bid_amount: input.bidAmount } : {}),
    targeting: input.targeting ?? defaultTargeting(),
    status: input.status ?? 'PAUSED',
    ...(input.startTime ? { start_time: input.startTime } : {}),
    ...(input.pixelId
      ? { promoted_object: { pixel_id: input.pixelId, custom_event_type: input.customEventType ?? 'PURCHASE' } }
      : {}),
  });
}

export type UploadedVideo = { id: string };

/** 動画のアップロード。実ファイルが無い（プレースホルダ）場合はサンドボックス扱いにする。 */
export async function uploadVideo(adAccountId: string, absolutePath: string | null, name: string): Promise<UploadedVideo> {
  if (isSandbox() || !absolutePath) {
    log.info('[sandbox] 動画アップロード', { name });
    return { id: sandboxId('vid') };
  }
  const form = new FormData();
  form.set('name', name);
  form.set('access_token', token());
  form.set('source', new Blob([new Uint8Array(readFileSync(absolutePath))]), name);
  return request<UploadedVideo>(`${baseUrl()}/${adAccountId}/advideos`, {
    method: 'POST',
    body: form,
    timeoutMs: 600_000,
  });
}

export async function uploadImage(adAccountId: string, absolutePath: string | null, name: string): Promise<{ hash: string }> {
  if (isSandbox() || !absolutePath) {
    log.info('[sandbox] 画像アップロード', { name });
    return { hash: sandboxId('img') };
  }
  const form = new FormData();
  form.set('access_token', token());
  form.set('filename', new Blob([new Uint8Array(readFileSync(absolutePath))]), name);
  const res = await request<{ images: Record<string, { hash: string }> }>(
    `${baseUrl()}/${adAccountId}/adimages`,
    { method: 'POST', body: form, timeoutMs: 300_000 },
  );
  const first = Object.values(res.images ?? {})[0];
  if (!first) throw upstream('画像アップロードのレスポンスが不正です');
  return { hash: first.hash };
}

export type CreateCreativeInput = {
  adAccountId: string;
  name: string;
  pageId: string;
  instagramActorId?: string;
  message: string;
  headline: string;
  description?: string;
  linkUrl: string;
  callToActionType?: string;
  videoId?: string;
  imageHash?: string;
  thumbnailUrl?: string;
};

export async function createCreative(input: CreateCreativeInput): Promise<{ id: string }> {
  if (isSandbox()) {
    log.info('[sandbox] クリエイティブ作成', { name: input.name });
    return { id: sandboxId('creative') };
  }
  const linkData = {
    link: input.linkUrl,
    message: input.message,
    name: input.headline,
    description: input.description,
    call_to_action: { type: input.callToActionType ?? 'LEARN_MORE', value: { link: input.linkUrl } },
    ...(input.imageHash ? { image_hash: input.imageHash } : {}),
  };
  const objectStorySpec = input.videoId
    ? {
        page_id: input.pageId,
        ...(input.instagramActorId ? { instagram_actor_id: input.instagramActorId } : {}),
        video_data: {
          video_id: input.videoId,
          message: input.message,
          title: input.headline,
          link_description: input.description,
          call_to_action: { type: input.callToActionType ?? 'LEARN_MORE', value: { link: input.linkUrl } },
          ...(input.thumbnailUrl ? { image_url: input.thumbnailUrl } : {}),
        },
      }
    : {
        page_id: input.pageId,
        ...(input.instagramActorId ? { instagram_actor_id: input.instagramActorId } : {}),
        link_data: linkData,
      };

  return graphPost(`${input.adAccountId}/adcreatives`, {
    name: input.name,
    object_story_spec: objectStorySpec,
    degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } },
  });
}

export async function createAd(input: {
  adAccountId: string;
  adSetId: string;
  creativeId: string;
  name: string;
  status?: 'ACTIVE' | 'PAUSED';
}): Promise<{ id: string }> {
  if (isSandbox()) {
    log.info('[sandbox] 広告作成', { name: input.name });
    return { id: sandboxId('ad') };
  }
  return graphPost(`${input.adAccountId}/ads`, {
    name: input.name,
    adset_id: input.adSetId,
    creative: { creative_id: input.creativeId },
    status: input.status ?? 'PAUSED',
  });
}

export async function updateObject(remoteId: string, fields: Record<string, unknown>): Promise<{ success?: boolean }> {
  if (isSandbox()) {
    log.info('[sandbox] オブジェクト更新', { remoteId, fields });
    return { success: true };
  }
  return graphPost(remoteId, fields);
}

// ---------------- インサイト ----------------

export type InsightRow = {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  video_p25_watched_actions?: { value: string }[];
  video_p75_watched_actions?: { value: string }[];
  video_thruplay_watched_actions?: { value: string }[];
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
};

const INSIGHT_FIELDS = [
  'spend', 'impressions', 'clicks', 'reach', 'frequency',
  'actions', 'action_values',
  'video_p25_watched_actions', 'video_p75_watched_actions', 'video_thruplay_watched_actions',
  'campaign_id', 'adset_id', 'ad_id',
].join(',');

export async function fetchInsights(input: {
  adAccountId: string;
  level: 'campaign' | 'adset' | 'ad';
  since: string;
  until: string;
}): Promise<InsightRow[]> {
  if (isSandbox()) return [];
  const res = await graphGet<{ data?: InsightRow[] }>(`${input.adAccountId}/insights`, {
    level: input.level,
    fields: INSIGHT_FIELDS,
    time_range: JSON.stringify({ since: input.since, until: input.until }),
    time_increment: 1,
    limit: 500,
  });
  return res.data ?? [];
}

/** actions 配列から目的のイベント数を取り出す */
export function actionValue(rows: { action_type: string; value: string }[] | undefined, types: string[]): number {
  if (!rows) return 0;
  for (const type of types) {
    const hit = rows.find((r) => r.action_type === type);
    if (hit) return Math.round(Number(hit.value) || 0);
  }
  return 0;
}

export const CONVERSION_ACTION_TYPES = [
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_lead',
  'lead',
  'offsite_conversion.fb_pixel_complete_registration',
];
