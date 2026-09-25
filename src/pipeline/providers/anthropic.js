// Anthropic（Claude）用のプロバイダ。公式SDKでストリーミング呼び出しし、最終メッセージからテキストと使用量を返す。
import Anthropic from '@anthropic-ai/sdk';
import { ConfigError, RefusalError } from '../errors.js';

// 動的フィルタリング付きのWeb検索ツールに対応しているモデル。それ以外は基本版を使う
const DYNAMIC_WEB_SEARCH = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/;
const MAX_CONTINUATIONS = 5;
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|mythos-5)/;

export function webSearchToolType(model, override) {
  if (override) return override;
  return DYNAMIC_WEB_SEARCH.test(model) ? 'web_search_20260209' : 'web_search_20250305';
}

// フォールバックが起きた場合は usage.iterations に試行ごとの使用量が入る
export function usageEntries(msg) {
  const u = msg.usage || {};
  const list = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
  return list.map((e) => ({
    model: e.model || msg.model,
    inputTokens: e.input_tokens ?? 0,
    outputTokens: e.output_tokens ?? 0,
    cacheWriteTokens: e.cache_creation_input_tokens ?? 0,
    cacheReadTokens: e.cache_read_input_tokens ?? 0,
  }));
}

// client はテストで差し替えるための引数（通常は省略）
export function createAnthropicProvider(config, { client } = {}) {
  try {
    client ||= new Anthropic({ maxRetries: 3 });
  } catch (e) {
    throw new ConfigError(`Anthropic API の認証情報が見つかりません。.env に ANTHROPIC_API_KEY を設定してください（お試しは npm run demo）。詳細: ${e.message}`);
  }

  return {
    name: 'anthropic',
    async complete({ role, model, system, messages, maxTokens, webSearch }) {
      const params = { model, max_tokens: maxTokens, system, messages: [...messages] };
      if (webSearch) params.tools = [{ type: webSearchToolType(model, config.webSearch.toolType), name: 'web_search', max_uses: webSearch.maxUses }];
      if (config.effort) params.output_config = { effort: config.effort };
      // 安全分類で断られた場合に、推奨モデルでサーバー側が自動で再実行する（対応しているモデルだけ）
      const useFallback = config.refusalFallback === 'default' && FALLBACK_MODELS.test(model);

      const texts = [];
      const entries = [];
      let webSearches = 0;
      let msg;
      try {
        for (let i = 0; ; i++) {
          const stream = useFallback
            ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
            : client.messages.stream(params);
          msg = await stream.finalMessage();
          entries.push(...usageEntries(msg));
          webSearches += msg.usage?.server_tool_use?.web_search_requests ?? 0;
          texts.push(...msg.content.filter((b) => b.type === 'text').map((b) => b.text));
          // サーバー側ツールのループが上限に達したら、同じ会話を送り直すと続きから再開する
          if (msg.stop_reason !== 'pause_turn' || i >= MAX_CONTINUATIONS) break;
          params.messages = [...params.messages, { role: 'assistant', content: msg.content }];
        }
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new ConfigError('Anthropic API キーが無効です。.env の ANTHROPIC_API_KEY を確認してください');
        if (e instanceof Anthropic.NotFoundError) throw new ConfigError(`モデル ${model} が見つかりません。.env の LLM_MODEL を確認してください`);
        if (e instanceof Anthropic.APIError) throw e;
        throw new ConfigError(`Anthropic API を呼び出せませんでした（${e.message}）。ANTHROPIC_API_KEY とネットワーク接続を確認してください`);
      }
      if (msg.stop_reason === 'refusal') throw new RefusalError(role, msg.stop_details?.category, msg.stop_details?.explanation);
      return { text: texts.join(''), usage: { entries, webSearches }, stopReason: msg.stop_reason, model: msg.model };
    },
  };
}
