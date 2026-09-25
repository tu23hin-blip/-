// 実行前・書き直し前の費用見積もり（各役の標準的な入出力量から計算する）
import { ROLES, WEB_SEARCH_INPUT_TOKENS } from './roles.js';

export const PRODUCE_STEPS = ['editorInChief', 'researcher', 'outliner', 'writer', 'diagrammer', 'reviewer', 'eyecatch', 'xConverter', 'xPlanner'];
export const REWRITE_STEPS = ['writer', 'diagrammer', 'reviewer'];
export const TAIL_STEPS = ['eyecatch', 'xConverter', 'xPlanner'];

export function estimateRole(config, cost, role) {
  const r = ROLES[role];
  const searches = r.webSearch ? config.webSearch.maxUses : 0;
  return cost.estimate({
    model: config.modelFor(role),
    inputTokens: r.typicalInputTokens + searches * WEB_SEARCH_INPUT_TOKENS,
    outputTokens: r.expectedOutputTokens,
    webSearches: searches,
  });
}

export const estimateRoles = (config, cost, roles) => roles.reduce((sum, role) => sum + estimateRole(config, cost, role), 0);

export function estimateProduce(config, cost, rewrites = 2) {
  const image = config.image.provider ? config.image.pricePerImage : 0;
  const base = estimateRoles(config, cost, PRODUCE_STEPS) + image;
  return { base, worst: base + rewrites * estimateRoles(config, cost, REWRITE_STEPS) };
}

// 書き直しをもう1回して、その後の工程（アイキャッチ・X投稿）まで上限内に収まるか
export function canAffordRewrite(config, cost) {
  if (!(cost.limitUsd > 0)) return true;
  return cost.spentUsd + estimateRoles(config, cost, [...REWRITE_STEPS, ...TAIL_STEPS]) <= cost.limitUsd;
}
