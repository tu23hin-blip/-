import { config } from '../../config/env.ts';
import { request } from '../../lib/http.ts';
import type { LlmProvider, LlmRequest, LlmResult } from '../types.ts';

type MessagesResponse = {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function createAnthropicLlm(): LlmProvider {
  const model = config.llm.anthropicModel;
  return {
    name: 'anthropic',
    model,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const system = req.json
        ? `${req.system ?? ''}\n\n有効な JSON のみを出力すること。前置き・コードフェンスは禁止。`.trim()
        : req.system;
      const res = await request<MessagesResponse>(`${config.llm.anthropicBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.llm.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          max_tokens: req.maxTokens ?? 4000,
          temperature: req.temperature ?? 0.7,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: req.prompt }],
        },
        timeoutMs: 180_000,
      });
      const text = (res.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      return {
        text,
        provider: 'anthropic',
        model,
        usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
      };
    },
  };
}
