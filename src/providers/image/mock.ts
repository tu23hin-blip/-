import { save } from '../storage/local.ts';
import { storyboardSvg } from '../mockart.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { ImageProvider, ImageRequest, ImageResult } from '../types.ts';

export function createMockImage(): ImageProvider {
  return {
    name: 'mock',
    model: 'mock-image-v1',
    async generate(req: ImageRequest): Promise<ImageResult> {
      const size = ASPECT_SIZES[req.aspectRatio];
      const path = req.outputPath.replace(/\.(png|jpg|jpeg|webp)$/i, '.svg');
      const stored = save(path, storyboardSvg({
        prompt: req.prompt,
        aspectRatio: req.aspectRatio,
        label: 'AI IMAGE (mock)',
      }));
      return {
        provider: 'mock',
        model: 'mock-image-v1',
        storagePath: stored.path,
        bytes: stored.bytes,
        width: size.width,
        height: size.height,
        placeholder: true,
      };
    },
  };
}
