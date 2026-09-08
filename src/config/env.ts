/**
 * 環境設定。すべての外部依存は「MOCK にフォールバックできる」ことを前提にしている。
 * 鍵が無い状態でも全パイプラインが最後まで完走することが、この基盤の設計上の要件。
 */

const raw = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key]?.trim().toLowerCase();
  if (v === undefined || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};
const num = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
};

export type LlmProviderName = 'mock' | 'openai' | 'anthropic';
export type VideoProviderName = 'mock' | 'sora' | 'seedance' | 'astora';
export type ImageProviderName = 'mock' | 'openai';
export type TtsProviderName = 'mock' | 'openai';

export const config = {
  env: raw('NODE_ENV', 'development'),
  port: num('PORT', 8787),
  baseUrl: raw('BASE_URL', 'http://localhost:8787'),
  tz: raw('TZ', 'Asia/Tokyo'),
  logLevel: raw('LOG_LEVEL', 'info'),
  databasePath: raw('DATABASE_PATH', './var/asp.db'),
  storageDir: raw('STORAGE_DIR', './var/storage'),
  bootstrapApiKey: raw('BOOTSTRAP_API_KEY', 'changeme-bootstrap-key'),

  llm: {
    provider: raw('LLM_PROVIDER', 'mock') as LlmProviderName,
    openaiKey: raw('OPENAI_API_KEY'),
    openaiBaseUrl: raw('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    openaiModel: raw('OPENAI_TEXT_MODEL', 'gpt-5.1'),
    anthropicKey: raw('ANTHROPIC_API_KEY'),
    anthropicBaseUrl: raw('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    anthropicModel: raw('ANTHROPIC_MODEL', 'claude-opus-5'),
  },

  video: {
    provider: raw('VIDEO_PROVIDER', 'mock') as VideoProviderName,
    sora: {
      key: raw('SORA_API_KEY') || raw('OPENAI_API_KEY'),
      baseUrl: raw('SORA_BASE_URL', 'https://api.openai.com/v1'),
      model: raw('SORA_MODEL', 'sora-2'),
    },
    seedance: {
      key: raw('SEEDANCE_API_KEY'),
      baseUrl: raw('SEEDANCE_BASE_URL', 'https://ark.ap-southeast.bytepluses.com/api/v3'),
      model: raw('SEEDANCE_MODEL', 'seedance-1-0-pro'),
    },
    astora: {
      key: raw('ASTORA_API_KEY'),
      baseUrl: raw('ASTORA_BASE_URL'),
      model: raw('ASTORA_MODEL', 'astora-v1'),
    },
  },

  image: {
    provider: raw('IMAGE_PROVIDER', 'mock') as ImageProviderName,
    model: raw('IMAGE_MODEL', 'gpt-image-1'),
  },

  tts: {
    provider: raw('TTS_PROVIDER', 'mock') as TtsProviderName,
    model: raw('TTS_MODEL', 'gpt-4o-mini-tts'),
    voice: raw('TTS_VOICE', 'alloy'),
  },

  render: {
    ffmpeg: raw('FFMPEG_PATH', 'ffmpeg'),
    ffprobe: raw('FFPROBE_PATH', 'ffprobe'),
    enabled: bool('RENDER_ENABLED', true),
  },

  meta: {
    enabled: bool('META_ENABLED', false),
    apiVersion: raw('META_API_VERSION', 'v21.0'),
    appId: raw('META_APP_ID'),
    appSecret: raw('META_APP_SECRET'),
    token: raw('META_SYSTEM_USER_TOKEN'),
    defaultAdAccountId: raw('META_DEFAULT_AD_ACCOUNT_ID', 'act_000000000000'),
    defaultPageId: raw('META_DEFAULT_PAGE_ID'),
    defaultPixelId: raw('META_DEFAULT_PIXEL_ID'),
  },

  report: {
    delivery: raw('REPORT_DELIVERY', 'store'),
    slackWebhookUrl: raw('SLACK_WEBHOOK_URL'),
    webhookUrl: raw('REPORT_WEBHOOK_URL'),
    smtpUrl: raw('SMTP_URL'),
    from: raw('REPORT_FROM', 'report@example.com'),
    dailyHourJst: num('DAILY_REPORT_CRON_HOUR', 9),
  },

  company: {
    name: raw('COMPANY_NAME', '株式会社サンプルメディア'),
    address: raw('COMPANY_ADDRESS', '東京都渋谷区1-1-1'),
    tel: raw('COMPANY_TEL', '03-0000-0000'),
    invoiceNo: raw('COMPANY_INVOICE_NO', 'T1234567890123'),
    bank: raw('COMPANY_BANK', ''),
    sealText: raw('COMPANY_SEAL_TEXT', ''),
  },
} as const;

/** 実鍵が無い provider は自動的に mock に落とす（起動を止めない） */
export function effectiveLlmProvider(): LlmProviderName {
  if (config.llm.provider === 'openai' && !config.llm.openaiKey) return 'mock';
  if (config.llm.provider === 'anthropic' && !config.llm.anthropicKey) return 'mock';
  return config.llm.provider;
}

export function effectiveVideoProvider(): VideoProviderName {
  const p = config.video.provider;
  if (p === 'sora' && !config.video.sora.key) return 'mock';
  if (p === 'seedance' && !config.video.seedance.key) return 'mock';
  if (p === 'astora' && !(config.video.astora.key && config.video.astora.baseUrl)) return 'mock';
  return p;
}
