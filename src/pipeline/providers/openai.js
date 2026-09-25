// OpenAI 用のプロバイダ（Responses API）。LLM_PROVIDER=openai のとき、または画像生成（IMAGE_API_PROVIDER=openai）で使う。
import OpenAI from 'openai';
import { ConfigError } from '../errors.js';

function createClient() {
  if (!process.env.OPENAI_API_KEY) throw new ConfigError('OPENAI_API_KEY が設定されていません。.env を確認してください');
  return new OpenAI({ maxRetries: 3 });
}

export function createOpenAIProvider() {
  const client = createClient();
  return {
    name: 'openai',
    async complete({ model, system, messages, maxTokens, webSearch }) {
      const params = { model, instructions: system, input: messages.map((m) => ({ role: m.role, content: m.content })), max_output_tokens: maxTokens };
      if (webSearch) params.tools = [{ type: 'web_search' }];
      const res = await client.responses.create(params);
      return {
        text: res.output_text || '',
        usage: {
          entries: [{ model: res.model || model, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }],
          webSearches: (res.output || []).filter((o) => o.type === 'web_search_call').length,
        },
        stopReason: res.status === 'incomplete' ? 'max_tokens' : 'end_turn',
        model: res.model || model,
      };
    },
  };
}

// アイキャッチ背景用。文字は含めない前提のプロンプトを受け取り、PNGのBufferを返す
export async function generateImageOpenAI({ model, prompt }) {
  const client = createClient();
  const res = await client.images.generate({ model, prompt, size: '1536x1024' });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像生成APIから画像が返りませんでした');
  return Buffer.from(b64, 'base64');
}
