import type { AspectRatio } from '../domain/types.ts';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmRequest = {
  system?: string;
  prompt: string;
  /** JSON だけを返させたいとき true（プロバイダ側の JSON モードを使う） */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 呼び出し元を識別するタグ（ログ・コスト集計用） */
  tag?: string;
};

export type LlmResult = {
  text: string;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type LlmProvider = {
  name: string;
  model: string;
  complete(req: LlmRequest): Promise<LlmResult>;
};

export type VideoRequest = {
  prompt: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  /** 参照画像（提供素材 or 生成画像）の絶対パス。image-to-video に使う。 */
  referenceImagePath?: string;
  seed?: number;
  /** 保存先の相対パス（拡張子含む） */
  outputPath: string;
};

export type VideoResult = {
  provider: string;
  model: string;
  storagePath: string;
  bytes: number;
  durationSec: number;
  width: number;
  height: number;
  /** 実素材ではなくプレースホルダの場合 true（鍵未設定時のドライラン） */
  placeholder: boolean;
  previewPath?: string;
  remoteJobId?: string;
};

export type VideoProvider = {
  name: string;
  model: string;
  generate(req: VideoRequest): Promise<VideoResult>;
};

export type ImageRequest = {
  prompt: string;
  aspectRatio: AspectRatio;
  outputPath: string;
  referenceImagePath?: string;
};

export type ImageResult = {
  provider: string;
  model: string;
  storagePath: string;
  bytes: number;
  width: number;
  height: number;
  placeholder: boolean;
};

export type ImageProvider = {
  name: string;
  model: string;
  generate(req: ImageRequest): Promise<ImageResult>;
};

export type TtsRequest = {
  text: string;
  voice?: string;
  speed?: number;
  outputPath: string;
};

export type TtsResult = {
  provider: string;
  model: string;
  storagePath: string;
  bytes: number;
  durationSec: number;
  placeholder: boolean;
};

export type TtsProvider = {
  name: string;
  model: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;
};

export const ASPECT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
};
