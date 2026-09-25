// API費用の概算と上限管理。呼び出し前に「このまま呼ぶと上限を超えないか」を確認し、呼び出し後に実際の使用量で記録する。
import { CostLimitError } from './errors.js';

// USD / 100万トークン [入力, 出力]（Anthropic の公開価格。キャッシュ書き込みは入力の1.25倍、読み込みは0.1倍）
export const PRICES = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  mock: [0, 0],
};

// 単価が分からないモデルは高めの仮単価で見積もる（.env の LLM_PRICE_* で指定できる）
const UNKNOWN_PRICE = [10, 50];

export function priceFor(model, override = {}) {
  if (override.input != null && override.output != null) return { input: override.input, output: override.output, known: true };
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  const [input, output] = key ? PRICES[key] : UNKNOWN_PRICE;
  return { input, output, known: Boolean(key) };
}

// 文字数からトークン数を概算（日本語は1文字≒1トークン強、英数字は3〜4文字≒1トークン）
export function estimateTokens(text) {
  let tokens = 0;
  for (const ch of String(text ?? '')) tokens += ch.charCodeAt(0) < 128 ? 0.3 : 1.1;
  return Math.ceil(tokens);
}

export const usdToJpy = (usd, rate) => Math.round(usd * rate);
export const fmtUsd = (usd) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;

export class CostTracker {
  constructor({ limitUsd, usdJpy = 150, priceOverride = {}, webSearchPricePer1k = 10, log = () => {} }) {
    Object.assign(this, { limitUsd, usdJpy, priceOverride, webSearchPricePer1k, log });
    this.calls = [];
    this.spentUsd = 0;
    this.warned = new Set();
  }

  price(model) {
    const p = priceFor(model, this.priceOverride);
    if (!p.known && !this.warned.has(model)) {
      this.warned.add(model);
      this.log(`⚠ ${model} の単価が分からないため、仮の単価（入力$${p.input} / 出力$${p.output} 毎100万トークン）で概算します。.env の LLM_PRICE_INPUT_PER_MTOK / LLM_PRICE_OUTPUT_PER_MTOK で指定できます。`);
    }
    return p;
  }

  tokensUsd(model, { inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0 }) {
    const p = this.price(model);
    return (inputTokens * p.input + cacheWriteTokens * p.input * 1.25 + cacheReadTokens * p.input * 0.1 + outputTokens * p.output) / 1e6;
  }

  estimate({ model, inputTokens, outputTokens, webSearches = 0 }) {
    return this.tokensUsd(model, { inputTokens, outputTokens }) + (webSearches * this.webSearchPricePer1k) / 1000;
  }

  // 呼び出し前の確認。超えそうなら例外で止める
  ensureBudget(label, estimateUsd) {
    if (this.limitUsd > 0 && this.spentUsd + estimateUsd > this.limitUsd) {
      throw new CostLimitError(
        `費用の上限に達しそうなため停止しました（${label} の見込み ${fmtUsd(estimateUsd)}、使用済み ${fmtUsd(this.spentUsd)}、上限 ${fmtUsd(this.limitUsd)}）。` +
          '.env の COST_LIMIT_PER_RUN を上げるか、安いモデルに切り替えてください。',
        { spentUsd: this.spentUsd, estimateUsd, limitUsd: this.limitUsd },
      );
    }
  }

  // entries: モデルごとのトークン使用量（フォールバックでモデルが切り替わった場合は複数）
  record(label, { entries = [], webSearches = 0 }) {
    const usd = entries.reduce((s, e) => s + this.tokensUsd(e.model, e), 0) + (webSearches * this.webSearchPricePer1k) / 1000;
    const call = {
      label,
      models: [...new Set(entries.map((e) => e.model))],
      input_tokens: entries.reduce((s, e) => s + (e.inputTokens || 0) + (e.cacheWriteTokens || 0) + (e.cacheReadTokens || 0), 0),
      output_tokens: entries.reduce((s, e) => s + (e.outputTokens || 0), 0),
      web_searches: webSearches,
      usd: Math.round(usd * 1e6) / 1e6,
    };
    this.calls.push(call);
    this.spentUsd += usd;
    const search = webSearches ? `・検索 ${webSearches}回` : '';
    this.log(`   ↳ 入力 ${call.input_tokens.toLocaleString()} / 出力 ${call.output_tokens.toLocaleString()} トークン${search} → ${fmtUsd(usd)}（累計 ${fmtUsd(this.spentUsd)} / 上限 ${fmtUsd(this.limitUsd)}）`);
    return usd;
  }

  // 画像生成など、トークン以外の費用
  recordFixed(label, usd) {
    this.calls.push({ label, models: [], input_tokens: 0, output_tokens: 0, web_searches: 0, usd });
    this.spentUsd += usd;
    this.log(`   ↳ ${fmtUsd(usd)}（累計 ${fmtUsd(this.spentUsd)} / 上限 ${fmtUsd(this.limitUsd)}）`);
  }

  summary() {
    const total = Math.round(this.spentUsd * 1e4) / 1e4;
    return { total_usd: total, total_jpy: usdToJpy(total, this.usdJpy), limit_usd: this.limitUsd, usd_jpy: this.usdJpy, calls: this.calls };
  }
}
