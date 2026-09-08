import { save } from '../storage/local.ts';
import { silentWav } from '../mockart.ts';
import { estimateNarrationSeconds } from '../../lib/text.ts';
import type { TtsProvider, TtsRequest, TtsResult } from '../types.ts';

/**
 * 無音WAV + 読み上げ台本を実ファイルで残す。
 * 尺計算（1分あたり約350文字）は本番TTSでもほぼ一致するため、編集タイムラインの検証に使える。
 */
export function createMockTts(): TtsProvider {
  return {
    name: 'mock',
    model: 'mock-tts-v1',
    async synthesize(req: TtsRequest): Promise<TtsResult> {
      const duration = estimateNarrationSeconds(req.text) / (req.speed ?? 1);
      const path = req.outputPath.replace(/\.(mp3|m4a)$/i, '.wav');
      const stored = save(path, silentWav(duration));
      save(path.replace(/\.wav$/, '.txt'), req.text);
      return {
        provider: 'mock',
        model: 'mock-tts-v1',
        storagePath: stored.path,
        bytes: stored.bytes,
        durationSec: Math.round(duration * 10) / 10,
        placeholder: true,
      };
    },
  };
}
