import { config } from '../../config/env.ts';
import { request } from '../../lib/http.ts';
import { save } from '../storage/local.ts';
import { ASPECT_SIZES } from '../types.ts';
import type { ImageProvider, ImageRequest, ImageResult } from '../types.ts';
import { upstream } from '../../lib/errors.ts';

type ImagesResponse = { data?: { b64_json?: string; url?: string }[] };

export function createOpenAiImage(): ImageProvider {
  const model = config.image.model;
  return {
    name: 'openai',
    model,
    async generate(req: ImageRequest): Promise<ImageResult> {
      const target = ASPECT_SIZES[req.aspectRatio];
      // gpt-image-1 が受け付けるサイズに丸める
      const size = req.aspectRatio === '16:9' ? '1536x1024'
        : req.aspectRatio === '1:1' ? '1024x1024'
        : '1024x1536';

      const res = await request<ImagesResponse>(`${config.llm.openaiBaseUrl}/images/generations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.llm.openaiKey}` },
        body: { model, prompt: req.prompt, size, n: 1, quality: 'high' },
        timeoutMs: 240_000,
      });

      const item = res.data?.[0];
      if (!item) throw upstream('画像生成のレスポンスが空です');
      const bytes = item.b64_json
        ? Buffer.from(item.b64_json, 'base64')
        : Buffer.from(await request<ArrayBuffer>(item.url!, { raw: true }));
      const stored = save(req.outputPath, new Uint8Array(bytes));

      return {
        provider: 'openai',
        model,
        storagePath: stored.path,
        bytes: stored.bytes,
        width: target.width,
        height: target.height,
        placeholder: false,
      };
    },
  };
}
