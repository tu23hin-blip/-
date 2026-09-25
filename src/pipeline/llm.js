// AI役の呼び出しを1か所にまとめる。プロバイダ（Anthropic / OpenAI / mock）は .env の LLM_PROVIDER で切り替える。
// 流れ: プロンプト作成 → 費用の見込みを確認 → 呼び出し → JSONを取り出す → 失敗したら1回だけ出し直し
import { ROLES, WEB_SEARCH_ROLES, WEB_SEARCH_INPUT_TOKENS } from './roles.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { extractJson, missingKeys } from './json.js';
import { estimateTokens } from './cost.js';
import { LLMOutputError } from './errors.js';

export const SYSTEM_PROMPT =
  'あなたは「AI編集部」のメンバーとして、指示されたAI役を担当します。' +
  '回答は、指示された形式のJSONオブジェクト1つだけを出力してください。JSONの前後に説明文やコードフェンス（```）を付けないでください。';

export async function createProvider(config) {
  if (config.provider === 'mock') return (await import('./providers/mock.js')).createMockProvider(config);
  if (config.provider === 'openai') return (await import('./providers/openai.js')).createOpenAIProvider(config);
  return (await import('./providers/anthropic.js')).createAnthropicProvider(config);
}

export class LLM {
  constructor({ config, provider, cost, log = console.log }) {
    Object.assign(this, { config, provider, cost, log });
  }

  static async create(config, { cost, log }) {
    return new LLM({ config, provider: await createProvider(config), cost, log });
  }

  // extraInstruction: 作り直しの指摘など、章のプロンプトの後ろに付け足す指示
  async run(roleName, vars, { extraInstruction = '' } = {}) {
    const role = ROLES[roleName];
    if (!role) throw new Error(`未定義のAI役です: ${roleName}`);
    const model = this.config.modelFor(roleName);
    const webSearch = WEB_SEARCH_ROLES.includes(roleName) ? { maxUses: this.config.webSearch.maxUses } : null;
    let prompt = renderPrompt(loadPrompt(role.prompt, this.config.paths.prompts), vars);
    if (extraInstruction) prompt += `\n# 追加の指示\n${extraInstruction.trim()}\n`;
    const name = `${role.label}（${roleName}）`;
    this.log(`▶ ${name}  ${model}${webSearch ? '・Web検索あり' : ''}`);

    const messages = [{ role: 'user', content: prompt }];
    let res = await this.call(roleName, name, { model, messages, webSearch, role, vars, attempt: 1 });
    let parsed = this.parse(res, role);
    if (parsed.ok) return parsed.value;

    this.log(`   ⚠ ${parsed.error} → 1回だけ出し直しを依頼します`);
    let retryMessages;
    let retryWebSearch = null;
    if (res.stopReason === 'max_tokens' || !res.text.trim()) {
      // 途中で切れた出力は整形し直せないので、簡潔に書くよう指示して最初から出し直す
      retryMessages = [{ role: 'user', content: `${prompt}\n# 追加の指示\n前回は出力が長すぎて途中で切れました。各項目を簡潔にし、必ず最後までJSONを閉じてください。\n` }];
      retryWebSearch = webSearch;
    } else {
      retryMessages = [
        ...messages,
        { role: 'assistant', content: res.text },
        { role: 'user', content: `直前の出力を使えませんでした（${parsed.error}）。内容は保ったまま、指定された形式のJSONオブジェクト1つだけを出力し直してください。説明文やコードフェンスは付けないでください。` },
      ];
    }
    res = await this.call(roleName, `${name}の再試行`, { model, messages: retryMessages, webSearch: retryWebSearch, role, vars, attempt: 2 });
    parsed = this.parse(res, role);
    if (parsed.ok) return parsed.value;
    throw new LLMOutputError(`${name} の出力をJSONとして読み取れませんでした（${parsed.error}）`, { role: roleName, raw: res.text });
  }

  parse(res, role) {
    const r = extractJson(res.text);
    if (!r.ok) return r;
    const missing = missingKeys(r.value, role.required);
    return missing.length ? { ok: false, error: `必須の項目 ${missing.join(', ')} がありません` } : r;
  }

  async call(roleName, name, { model, messages, webSearch, role, vars, attempt }) {
    const inputTokens = estimateTokens(SYSTEM_PROMPT + messages.map((m) => m.content).join('\n')) + (webSearch ? webSearch.maxUses * WEB_SEARCH_INPUT_TOKENS : 0);
    const estimate = this.cost.estimate({ model, inputTokens, outputTokens: role.expectedOutputTokens, webSearches: webSearch?.maxUses || 0 });
    this.cost.ensureBudget(name, estimate);
    const res = await this.provider.complete({
      role: roleName, model, system: SYSTEM_PROMPT, messages, maxTokens: role.maxTokens, webSearch, context: { vars, attempt },
    });
    this.cost.record(name, res.usage);
    return res;
  }
}
