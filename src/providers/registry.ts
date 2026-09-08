import { config, effectiveLlmProvider, effectiveVideoProvider } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { stripJson } from '../lib/text.ts';
import type { ImageProvider, LlmProvider, LlmRequest, TtsProvider, VideoProvider } from './types.ts';

import { createMockLlm } from './llm/mock.ts';
import { createOpenAiLlm } from './llm/openai.ts';
import { createAnthropicLlm } from './llm/anthropic.ts';
import { createMockVideo } from './video/mock.ts';
import { createSoraVideo } from './video/sora.ts';
import { createSeedanceVideo } from './video/seedance.ts';
import { createAstoraVideo } from './video/astora.ts';
import { createMockImage } from './image/mock.ts';
import { createOpenAiImage } from './image/openai.ts';
import { createMockTts } from './tts/mock.ts';
import { createOpenAiTts } from './tts/openai.ts';

const log = createLogger('providers');

let llmCache: LlmProvider | null = null;
let videoCache: VideoProvider | null = null;
let imageCache: ImageProvider | null = null;
let ttsCache: TtsProvider | null = null;

export function llm(): LlmProvider {
  if (llmCache) return llmCache;
  const name = effectiveLlmProvider();
  llmCache = name === 'openai' ? createOpenAiLlm()
    : name === 'anthropic' ? createAnthropicLlm()
    : createMockLlm();
  log.info('LLMプロバイダ', { requested: config.llm.provider, effective: llmCache.name, model: llmCache.model });
  return llmCache;
}

/** 動画プロバイダはショットごとに切り替えたいことがあるため名前指定を許す */
export function video(preferred?: string): VideoProvider {
  const name = (preferred as typeof config.video.provider | undefined) ?? effectiveVideoProvider();
  if (!preferred && videoCache) return videoCache;
  const created = name === 'sora' && config.video.sora.key ? createSoraVideo()
    : name === 'seedance' && config.video.seedance.key ? createSeedanceVideo()
    : name === 'astora' && config.video.astora.key && config.video.astora.baseUrl ? createAstoraVideo()
    : createMockVideo();
  if (!preferred) {
    videoCache = created;
    log.info('動画プロバイダ', { requested: config.video.provider, effective: created.name, model: created.model });
  }
  return created;
}

export function image(): ImageProvider {
  if (imageCache) return imageCache;
  imageCache = config.image.provider === 'openai' && config.llm.openaiKey
    ? createOpenAiImage()
    : createMockImage();
  return imageCache;
}

export function tts(): TtsProvider {
  if (ttsCache) return ttsCache;
  ttsCache = config.tts.provider === 'openai' && config.llm.openaiKey
    ? createOpenAiTts()
    : createMockTts();
  return ttsCache;
}

export function resetProviders(): void {
  llmCache = null;
  videoCache = null;
  imageCache = null;
  ttsCache = null;
}

/** LLM に JSON を返させる共通ヘルパ。パースに失敗したら1度だけ矯正リトライする。 */
export async function completeJson<T>(req: LlmRequest, fallback: T): Promise<T> {
  const provider = llm();
  const first = await provider.complete({ ...req, json: true });
  try {
    return JSON.parse(stripJson(first.text)) as T;
  } catch {
    log.warn('JSONパース失敗。矯正リトライします', { tag: req.tag, provider: provider.name });
  }
  try {
    const retry = await provider.complete({
      ...req,
      json: true,
      temperature: 0,
      prompt: `${req.prompt}\n\n直前の出力が不正なJSONでした。有効なJSONのみを出力してください。`,
    });
    return JSON.parse(stripJson(retry.text)) as T;
  } catch {
    log.error('JSON生成に失敗。フォールバック値を使用', { tag: req.tag });
    return fallback;
  }
}

export function providerStatus() {
  return {
    llm: { requested: config.llm.provider, effective: effectiveLlmProvider(), model: llm().model },
    video: { requested: config.video.provider, effective: effectiveVideoProvider(), model: video().model },
    image: { requested: config.image.provider, effective: image().name, model: image().model },
    tts: { requested: config.tts.provider, effective: tts().name, model: tts().model },
    meta: { enabled: config.meta.enabled, apiVersion: config.meta.apiVersion },
    render: { ffmpeg: config.render.ffmpeg, enabled: config.render.enabled },
  };
}
