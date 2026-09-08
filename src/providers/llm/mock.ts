import type { LlmProvider, LlmRequest, LlmResult } from '../types.ts';
import { stripJson } from '../../lib/text.ts';

/**
 * 鍵なしでも全パイプラインを完走させるための決定論的スタブ。
 * プロンプトに埋め込まれた「JSONスキーマ例」を読み取り、それらしい構造を返す。
 * 本番では LLM_PROVIDER=openai / anthropic に切り替える。
 */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function fallbackJson(req: LlmRequest): string {
  const example = req.prompt.match(/```json\s*([\s\S]*?)```/);
  if (example?.[1]) {
    try {
      return JSON.stringify(JSON.parse(stripJson(example[1])));
    } catch {
      /* 例が壊れていれば下の汎用形にフォールバック */
    }
  }
  return JSON.stringify({ ok: true, note: 'mock-llm', echo: req.tag ?? null });
}

export function createMockLlm(): LlmProvider {
  return {
    name: 'mock',
    model: 'mock-llm-v1',
    async complete(req: LlmRequest): Promise<LlmResult> {
      const seed = seedFrom(req.prompt);
      const text = req.json
        ? fallbackJson(req)
        : `【mock出力 seed=${seed % 10000}】\n${req.prompt.slice(0, 240)}`;
      return {
        text,
        provider: 'mock',
        model: 'mock-llm-v1',
        usage: { inputTokens: req.prompt.length, outputTokens: text.length },
      };
    },
  };
}
