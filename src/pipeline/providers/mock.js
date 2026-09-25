// デモ・テスト用のプロバイダ。APIを呼ばずに固定の応答を返す（費用は0円）。
// MOCK_SCENARIO（カンマ区切り）で失敗パターンを再現できる:
//   bad_json_once / truncated_once / revise_once / always_revise / human_review / no_idea / bad_plan / dup_posts_once / long_labels_once
import { FIXTURES } from './mockFixtures.js';
import { estimateTokens } from '../cost.js';

export function createMockProvider(config) {
  const flags = new Set(String(config.mockScenario || '').split(',').map((s) => s.trim()).filter(Boolean));
  const calls = {};
  return {
    name: 'mock',
    calls,
    async complete({ role, model, system, messages, webSearch, context = {} }) {
      const n = (calls[role] = (calls[role] || 0) + 1);
      const fixture = FIXTURES[role];
      if (!fixture) throw new Error(`mock に ${role} の応答がありません`);
      let text;
      let stopReason = 'end_turn';
      if (flags.has('bad_json_once') && n === 1) {
        text = '承知しました。以下が出力です。\n{"broken": "閉じていないJSON';
      } else if (flags.has('truncated_once') && n === 1) {
        text = JSON.stringify(fixture({ vars: context.vars || {}, flags, n })).slice(0, 40);
        stopReason = 'max_tokens';
      } else {
        // 本物のモデルのように、前置きとコードフェンス付きで返す
        text = `\`\`\`json\n${JSON.stringify(fixture({ vars: context.vars || {}, flags, n }), null, 2)}\n\`\`\``;
      }
      const input = estimateTokens(system + messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'));
      return {
        text,
        usage: { entries: [{ model, inputTokens: input, outputTokens: estimateTokens(text) }], webSearches: 0 },
        stopReason,
        model,
      };
    },
  };
}
