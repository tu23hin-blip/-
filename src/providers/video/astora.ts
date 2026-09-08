import { config } from '../../config/env.ts';
import { pollUntil, request } from '../../lib/http.ts';
import { save, publicUrl } from '../storage/local.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { VideoProvider, VideoRequest, VideoResult } from '../types.ts';
import { upstream } from '../../lib/errors.ts';

type AstoraJob = {
  id: string;
  status: string;
  output?: { url?: string };
  error?: string;
};

/**
 * Astora 連携アダプタ。
 * 「create → poll → download」という汎用の非同期生成APIの形に合わせてある。
 * 実エンドポイントの差異は ASTORA_BASE_URL とこのファイルの3メソッドだけで吸収できる。
 */
export function createAstoraVideo(): VideoProvider {
  const model = config.video.astora.model;
  const base = config.video.astora.baseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${config.video.astora.key}` };

  return {
    name: 'astora',
    model,
    async generate(req: VideoRequest): Promise<VideoResult> {
      const size = ASPECT_SIZES[req.aspectRatio];
      const created = await request<AstoraJob>(`${base}/v1/video/generations`, {
        method: 'POST',
        headers,
        body: {
          model,
          prompt: req.prompt,
          duration: Math.round(req.durationSec),
          aspect_ratio: req.aspectRatio,
          resolution: `${size.width}x${size.height}`,
          ...(req.referenceImagePath ? { reference_image_url: publicUrl(req.referenceImagePath) } : {}),
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        timeoutMs: 120_000,
      });

      const done = await pollUntil(
        () => request<AstoraJob>(`${base}/v1/video/generations/${created.id}`, { headers }),
        (job) => ['succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(job.status),
        { intervalMs: 8_000, timeoutMs: 20 * 60_000 },
      );
      const ok = done.status === 'succeeded' || done.status === 'completed';
      if (!ok || !done.output?.url) throw upstream(`Astora 生成失敗: ${done.error ?? done.status}`);

      const bytes = await request<ArrayBuffer>(done.output.url, { raw: true, timeoutMs: 300_000 });
      const stored = save(req.outputPath, new Uint8Array(bytes));

      return {
        provider: 'astora',
        model,
        storagePath: stored.path,
        bytes: stored.bytes,
        durationSec: req.durationSec,
        width: size.width,
        height: size.height,
        placeholder: false,
        remoteJobId: created.id,
      };
    },
  };
}
