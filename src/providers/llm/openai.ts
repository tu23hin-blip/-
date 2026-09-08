import { config } from '../../config/env.ts';
import { request } from '../../lib/http.ts';
import type { LlmProvider, LlmRequest, LlmResult } from '../types.ts';

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** OpenAI Chat Completions 互換。ChatGPT 系モデル（gpt-5.1 等）を利用する。 */
export function createOpenAiLlm(): LlmProvider {
  const model = config.llm.openaiModel;
  return {
    name: 'openai',
    model,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const messages = [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ];
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_completion_tokens: req.maxTokens ?? 4000,
      };
      if (req.json) body['response_format'] = { type: 'json_object' };

      const res = await request<ChatResponse>(`${config.llm.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.llm.openaiKey}` },
        body,
        timeoutMs: 180_000,
      });
      return {
        text: res.choices?.[0]?.message?.content ?? '',
        provider: 'openai',
        model,
        usage: {
          inputTokens: res.usage?.prompt_tokens,
          outputTokens: res.usage?.completion_tokens,
        },
      };
    },
  };
}
