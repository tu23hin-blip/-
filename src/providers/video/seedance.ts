import { config } from '../../config/env.ts';
import { pollUntil, request } from '../../lib/http.ts';
import { save } from '../storage/local.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { VideoProvider, VideoRequest, VideoResult } from '../types.ts';
import { upstream } from '../../lib/errors.ts';
import { publicUrl } from '../storage/local.ts';

type SeedanceTask = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  content?: { video_url?: string };
  error?: { message?: string };
};

/**
 * Seedance（ByteDance Ark）の動画生成。
 * プロンプト末尾に --ratio / --duration のコマンド構文でパラメータを渡す方式。
 */
export function createSeedanceVideo(): VideoProvider {
  const model = config.video.seedance.model;
  const base = config.video.seedance.baseUrl;
  const headers = { authorization: `Bearer ${config.video.seedance.key}` };

  return {
    name: 'seedance',
    model,
    async generate(req: VideoRequest): Promise<VideoResult> {
      const size = ASPECT_SIZES[req.aspectRatio];
      const duration = Math.min(12, Math.max(3, Math.round(req.durationSec)));
      const commands = `--ratio ${req.aspectRatio} --duration ${duration} --resolution 1080p`;
      const content: Record<string, unknown>[] = [
        { type: 'text', text: `${req.prompt} ${commands}` },
      ];
      if (req.referenceImagePath) {
        content.push({ type: 'image_url', image_url: { url: publicUrl(req.referenceImagePath) }, role: 'first_frame' });
      }

      const created = await request<SeedanceTask>(`${base}/contents/generations/tasks`, {
        method: 'POST',
        headers,
        body: { model, content },
        timeoutMs: 120_000,
      });

      const done = await pollUntil(
        () => request<SeedanceTask>(`${base}/contents/generations/tasks/${created.id}`, { headers }),
        (task) => ['succeeded', 'failed', 'cancelled'].includes(task.status),
        { intervalMs: 8_000, timeoutMs: 20 * 60_000 },
      );
      if (done.status !== 'succeeded' || !done.content?.video_url) {
        throw upstream(`Seedance 生成失敗: ${done.error?.message ?? done.status}`);
      }

      const bytes = await request<ArrayBuffer>(done.content.video_url, { raw: true, timeoutMs: 300_000 });
      const stored = save(req.outputPath, new Uint8Array(bytes));

      return {
        provider: 'seedance',
        model,
        storagePath: stored.path,
        bytes: stored.bytes,
        durationSec: duration,
        width: size.width,
        height: size.height,
        placeholder: false,
        remoteJobId: created.id,
      };
    },
  };
}
