import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/pipeline/config.js';
import { LLM } from '../src/pipeline/llm.js';
import { CostTracker } from '../src/pipeline/cost.js';
import { createAnthropicProvider, webSearchToolType, usageEntries } from '../src/pipeline/providers/anthropic.js';
import { createMockProvider } from '../src/pipeline/providers/mock.js';

const EDITOR_VARS = { genre: '未指定', genres_json: [{ genre_id: 'g', status: 'active' }], winning_patterns: [], recent_titles: [], x_test_results: [], trend_digest: 'なし' };
const RESEARCH_VARS = { idea_json: { topic: 't' }, research_questions: [], experiment_data: 'なし' };

// 決まった応答を順番に返すプロバイダ。受け取った引数を記録する
function scripted(responses) {
  const calls = [];
  return {
    calls,
    async complete(args) {
      calls.push(args);
      const r = responses.shift();
      return { text: r.text, stopReason: r.stopReason || 'end_turn', usage: { entries: [{ model: args.model, inputTokens: 1000, outputTokens: 500 }], webSearches: r.webSearches || 0 } };
    },
  };
}

const setup = (provider, env = {}, limitUsd = 5) => {
  const config = getConfig({ LLM_PROVIDER: 'mock', LLM_PRICE_INPUT_PER_MTOK: '5', LLM_PRICE_OUTPUT_PER_MTOK: '25', ...env });
  const cost = new CostTracker({ limitUsd, priceOverride: config.price, log: () => {} });
  return { llm: new LLM({ config, provider, cost, log: () => {} }), cost };
};

test('llm: JSONが壊れていたら1回だけ出し直しを依頼し、前回の出力を渡す', async () => {
  const provider = scripted([{ text: 'すみません {"ideas": [' }, { text: '{"ideas": [{"topic": "ok"}]}' }]);
  const { llm, cost } = setup(provider);
  const out = await llm.run('editorInChief', EDITOR_VARS);
  assert.equal(out.ideas[0].topic, 'ok');
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(provider.calls[1].messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(provider.calls[1].messages[2].content, /JSONオブジェクト1つだけ/);
  assert.equal(cost.summary().calls.length, 2);
});

test('llm: 2回とも失敗したら LLMOutputError', async () => {
  const provider = scripted([{ text: 'だめ' }, { text: '{"no_ideas": true}' }]);
  const { llm } = setup(provider);
  await assert.rejects(llm.run('editorInChief', EDITOR_VARS), (e) => e.name === 'LLMOutputError' && e.message.includes('ideas'));
});

test('llm: 途中で切れた出力は、簡潔にするよう指示して最初から出し直す', async () => {
  const provider = scripted([{ text: '{"facts": [{"claim": "途中', stopReason: 'max_tokens' }, { text: '{"facts": []}' }]);
  const { llm } = setup(provider);
  await llm.run('researcher', RESEARCH_VARS);
  assert.equal(provider.calls[1].messages.length, 1);
  assert.match(provider.calls[1].messages[0].content, /途中で切れました/);
  assert.ok(provider.calls[1].webSearch, '出し直しでもWeb検索を使える');
});

test('llm: Web検索はリサーチャーと校閲だけに渡す', async () => {
  const provider = scripted([{ text: '{"facts": []}' }, { text: '{"ideas": []}' }]);
  const { llm } = setup(provider, { WEB_SEARCH_MAX_USES: '3' });
  await llm.run('researcher', RESEARCH_VARS);
  await llm.run('editorInChief', EDITOR_VARS);
  assert.deepEqual(provider.calls[0].webSearch, { maxUses: 3 });
  assert.equal(provider.calls[1].webSearch, null);
});

test('llm: 上限を超えそうなら呼び出す前に止める', async () => {
  const provider = scripted([{ text: '{"ideas": []}' }]);
  const { llm } = setup(provider, {}, 0.01);
  await assert.rejects(llm.run('editorInChief', EDITOR_VARS), (e) => e.name === 'CostLimitError');
  assert.equal(provider.calls.length, 0);
});

test('llm: 役ごとのモデル指定が使われる', async () => {
  const provider = scripted([{ text: '{"ideas": []}' }]);
  const { llm } = setup(provider, { LLM_MODEL_EDITOR_IN_CHIEF: 'claude-sonnet-5' });
  await llm.run('editorInChief', EDITOR_VARS);
  assert.equal(provider.calls[0].model, 'claude-sonnet-5');
});

test('mock: シナリオで壊れたJSONを再現でき、LLMが立て直せる', async () => {
  const config = getConfig({ LLM_PROVIDER: 'mock', MOCK_SCENARIO: 'bad_json_once' });
  const cost = new CostTracker({ limitUsd: 5, log: () => {} });
  const provider = createMockProvider(config);
  const llm = new LLM({ config, provider, cost, log: () => {} });
  const out = await llm.run('editorInChief', EDITOR_VARS);
  assert.equal(out.ideas.length, 3);
  assert.equal(provider.calls.editorInChief, 2);
});

// ── Anthropic プロバイダ（SDKの代わりに偽のクライアントを渡す） ──
function fakeClient(messages) {
  const seen = [];
  const stream = (kind) => (params) => {
    seen.push({ kind, params: structuredClone(params) });
    return { finalMessage: async () => messages.shift() };
  };
  return { seen, messages: { stream: stream('messages') }, beta: { messages: { stream: stream('beta') } } };
}

const msg = (over) => ({ model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 50 }, ...over });

test('anthropic: Web検索ツール・フォールバック・pause_turn の再開・使用量の合算', async () => {
  const client = fakeClient([
    msg({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }, { type: 'text', text: '{"facts": [' }], usage: { input_tokens: 1000, output_tokens: 10, server_tool_use: { web_search_requests: 2 } } }),
    msg({ content: [{ type: 'text', text: ']}' }], usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 500, server_tool_use: { web_search_requests: 1 } } }),
  ]);
  const provider = createAnthropicProvider(getConfig({}), { client });
  const res = await provider.complete({ role: 'researcher', model: 'claude-opus-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 1000, webSearch: { maxUses: 5 } });
  assert.equal(res.text, '{"facts": []}');
  assert.equal(res.usage.webSearches, 3);
  assert.equal(res.usage.entries.length, 2);
  assert.equal(res.usage.entries[1].cacheReadTokens, 500);
  const first = client.seen[0];
  assert.equal(first.kind, 'beta');
  assert.deepEqual(first.params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(first.params.fallbacks, 'default');
  assert.deepEqual(first.params.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
  assert.deepEqual(client.seen[1].params.messages.map((m) => m.role), ['user', 'assistant']);
});

test('anthropic: フォールバックを無効にすると通常のAPI、断られたら RefusalError', async () => {
  const client = fakeClient([msg({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } })]);
  const provider = createAnthropicProvider(getConfig({ LLM_REFUSAL_FALLBACK: '' }), { client });
  await assert.rejects(provider.complete({ role: 'writer', model: 'claude-opus-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10 }), (e) => e.name === 'RefusalError' && e.message.includes('cyber'));
  assert.equal(client.seen[0].kind, 'messages');
  assert.equal(client.seen[0].params.tools, undefined);
});

test('anthropic: 検索ツールの版とフォールバック時の使用量', () => {
  assert.equal(webSearchToolType('claude-opus-5'), 'web_search_20260209');
  assert.equal(webSearchToolType('claude-sonnet-4-6'), 'web_search_20260209');
  assert.equal(webSearchToolType('claude-haiku-4-5'), 'web_search_20250305');
  assert.equal(webSearchToolType('claude-haiku-4-5', 'web_search_20260209'), 'web_search_20260209');
  const entries = usageEntries({ model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 5, iterations: [{ type: 'message', model: 'claude-opus-5', input_tokens: 10, output_tokens: 0 }, { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 20, output_tokens: 30 }] } });
  assert.deepEqual(entries.map((e) => [e.model, e.inputTokens, e.outputTokens]), [['claude-opus-5', 10, 0], ['claude-opus-4-8', 20, 30]]);
});
