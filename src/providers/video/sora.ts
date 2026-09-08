import { readFileSync } from 'node:fs';
import { config } from '../../config/env.ts';
import { pollUntil, request } from '../../lib/http.ts';
import { save } from '../storage/local.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { VideoProvider, VideoRequest, VideoResult } from '../types.ts';
import { upstream } from '../../lib/errors.ts';

type SoraJob = { id: string; status: string; error?: { message?: string } };

/**
 * OpenAI Sora（動画生成）。作成 → ポーリング → コンテンツ取得 の3段構え。
 * image-to-video の入力画像は「提供素材 or 自社生成画像」のみを渡す運用に固定している。
 */
export function createSoraVideo(): VideoProvider {
  const model = config.video.sora.model;
  const base = config.video.sora.baseUrl;
  const headers = { authorization: `Bearer ${config.video.sora.key}` };

  return {
    name: 'sora',
    model,
    async generate(req: VideoRequest): Promise<VideoResult> {
      const size = ASPECT_SIZES[req.aspectRatio];
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', req.prompt);
      form.set('seconds', String(Math.max(4, Math.round(req.durationSec))));
      form.set('size', `${size.width}x${size.height}`);
      if (req.referenceImagePath) {
        const bytes = readFileSync(req.referenceImagePath);
        form.set('input_reference', new Blob([new Uint8Array(bytes)]), 'reference.png');
      }

      const created = await request<SoraJob>(`${base}/videos`, {
        method: 'POST',
        headers,
        body: form,
        timeoutMs: 180_000,
      });

      const done = await pollUntil(
        () => request<SoraJob>(`${base}/videos/${created.id}`, { headers }),
        (job) => ['completed', 'failed', 'cancelled'].includes(job.status),
        { intervalMs: 8_000, timeoutMs: 20 * 60_000 },
      );
      if (done.status !== 'completed') {
        throw upstream(`Sora 生成失敗: ${done.error?.message ?? done.status}`);
      }

      const content = await request<ArrayBuffer>(`${base}/videos/${created.id}/content`, {
        headers,
        raw: true,
        timeoutMs: 300_000,
      });
      const stored = save(req.outputPath, new Uint8Array(content));

      return {
        provider: 'sora',
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
