import { save } from '../storage/local.ts';
import { storyboardSvg } from '../mockart.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { VideoProvider, VideoRequest, VideoResult } from '../types.ts';

/**
 * 動画生成のドライラン。鍵が無い環境でも「カットごとの絵コンテ SVG」を実ファイルとして残す。
 * これにより構成・尺・カット割りのレビューまでは実データで回せる。
 */
export function createMockVideo(): VideoProvider {
  return {
    name: 'mock',
    model: 'mock-video-v1',
    async generate(req: VideoRequest): Promise<VideoResult> {
      const size = ASPECT_SIZES[req.aspectRatio];
      const previewPath = req.outputPath.replace(/\.[^.]+$/, '') + '.preview.svg';
      const svg = storyboardSvg({
        prompt: req.prompt,
        aspectRatio: req.aspectRatio,
        label: 'AI VIDEO (mock)',
        durationSec: req.durationSec,
      });
      const preview = save(previewPath, svg);
      const spec = save(req.outputPath.replace(/\.[^.]+$/, '') + '.spec.json', JSON.stringify({
        placeholder: true,
        prompt: req.prompt,
        durationSec: req.durationSec,
        aspectRatio: req.aspectRatio,
        referenceImagePath: req.referenceImagePath ?? null,
        seed: req.seed ?? null,
        note: 'VIDEO_PROVIDER を sora / seedance / astora に切り替えると実動画が入ります',
      }, null, 2));

      return {
        provider: 'mock',
        model: 'mock-video-v1',
        storagePath: preview.path,
        bytes: preview.bytes + spec.bytes,
        durationSec: req.durationSec,
        width: size.width,
        height: size.height,
        placeholder: true,
        previewPath: preview.path,
      };
    },
  };
}
