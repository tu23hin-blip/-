// .env から設定を読み込む。値はすべて環境変数で上書きでき、テストでは env オブジェクトを直接渡す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './errors.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadEnvFile(file = path.join(ROOT, '.env')) {
  // 既に設定されている環境変数は上書きされない
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const num = (v, fallback) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));
const list = (v) => String(v || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

// xConverter → X_CONVERTER（役ごとのモデル上書き LLM_MODEL_X_CONVERTER 用）
export const envKey = (role) => role.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

const DEFAULT_MODELS = { anthropic: 'claude-opus-5', mock: 'mock' };

// 1日の投稿本数に対して時刻が足りない場合は 7:00〜22:00 を等間隔で埋める
function postTimes(times, perDay) {
  if (times.length >= perDay) return times.slice(0, perDay);
  return Array.from({ length: perDay }, (_, i) => {
    const minutes = 7 * 60 + Math.round((i * 15 * 60) / Math.max(1, perDay - 1));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
}

export function getConfig(env = process.env) {
  const provider = String(env.LLM_PROVIDER || 'anthropic').toLowerCase();
  if (!['anthropic', 'openai', 'mock'].includes(provider)) {
    throw new ConfigError(`LLM_PROVIDER は anthropic / openai / mock のいずれかにしてください（現在: ${provider}）`);
  }
  const model = env.LLM_MODEL || DEFAULT_MODELS[provider] || '';
  if (!model) throw new ConfigError('LLM_PROVIDER=openai のときは LLM_MODEL にモデル名を指定してください');
  const perDay = Math.max(1, Math.min(10, num(env.X_POSTS_PER_DAY, 3)));

  return {
    provider,
    model,
    modelFor: (role) => env[`LLM_MODEL_${envKey(role)}`] || model,
    effort: env.LLM_EFFORT || '',
    refusalFallback: env.LLM_REFUSAL_FALLBACK ?? 'default',
    price: { input: num(env.LLM_PRICE_INPUT_PER_MTOK, null), output: num(env.LLM_PRICE_OUTPUT_PER_MTOK, null) },
    webSearch: {
      maxUses: Math.max(1, num(env.WEB_SEARCH_MAX_USES, 5)),
      toolType: env.WEB_SEARCH_TOOL_TYPE || '',
      pricePer1k: num(env.WEB_SEARCH_PRICE_PER_1K, 10),
    },
    costLimitUsd: num(env.COST_LIMIT_PER_RUN, 7),
    usdJpy: num(env.USD_JPY, 150),
    image: {
      provider: String(env.IMAGE_API_PROVIDER || '').toLowerCase(),
      model: env.IMAGE_MODEL || 'gpt-image-1',
      pricePerImage: num(env.IMAGE_PRICE_PER_IMAGE, 0.08),
    },
    x: {
      postsPerDay: perDay,
      times: postTimes(list(env.X_POST_TIMES || '07:30,12:15,21:00'), perDay),
      notePublishTime: env.NOTE_PUBLISH_TIME || '07:00',
    },
    timezone: env.TIMEZONE || 'Asia/Tokyo',
    trendFeeds: list(env.TREND_FEEDS),
    chromiumPath: env.CHROMIUM_PATH || '',
    mockScenario: env.MOCK_SCENARIO || '',
    paths: {
      root: ROOT,
      data: env.EDITORIAL_DATA_DIR || path.join(ROOT, 'data'),
      output: env.EDITORIAL_OUTPUT_DIR || path.join(ROOT, 'output'),
      prompts: env.EDITORIAL_PROMPTS_DIR || path.join(ROOT, 'prompts'),
      templates: path.join(ROOT, 'templates'),
      promptDoc: path.join(ROOT, 'docs', 'ai-editorial-prompts.md'),
    },
  };
}
