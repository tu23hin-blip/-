// パイプライン共通のエラー。CLI はこれらを見て、分かりやすい日本語メッセージと終了コードを出す。

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class CostLimitError extends Error {
  constructor(message, { spentUsd, estimateUsd, limitUsd } = {}) {
    super(message);
    this.name = 'CostLimitError';
    Object.assign(this, { spentUsd, estimateUsd, limitUsd });
  }
}

export class LLMOutputError extends Error {
  constructor(message, { role, raw } = {}) {
    super(message);
    this.name = 'LLMOutputError';
    Object.assign(this, { role, raw });
  }
}

export class RefusalError extends Error {
  constructor(role, category, explanation) {
    super(`${role} の依頼がAIに断られました（分類: ${category || '不明'}）${explanation ? `：${explanation}` : ''}`);
    this.name = 'RefusalError';
    Object.assign(this, { role, category });
  }
}
