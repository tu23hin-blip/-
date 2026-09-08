import { config } from '../../config/env.ts';
import { request } from '../../lib/http.ts';
import { save } from '../storage/local.ts';
import { estimateNarrationSeconds } from '../../lib/text.ts';
import type { TtsProvider, TtsRequest, TtsResult } from '../types.ts';

export function createOpenAiTts(): TtsProvider {
  const model = config.tts.model;
  return {
    name: 'openai',
    model,
    async synthesize(req: TtsRequest): Promise<TtsResult> {
      const buf = await request<ArrayBuffer>(`${config.llm.openaiBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.llm.openaiKey}` },
        body: {
          model,
          input: req.text,
          voice: req.voice ?? config.tts.voice,
          speed: req.speed ?? 1,
          response_format: 'mp3',
        },
        raw: true,
        timeoutMs: 180_000,
      });
      const stored = save(req.outputPath, new Uint8Array(buf));
      return {
        provider: 'openai',
        model,
        storagePath: stored.path,
        bytes: stored.bytes,
        durationSec: estimateNarrationSeconds(req.text) / (req.speed ?? 1),
        placeholder: false,
      };
    },
  };
}
