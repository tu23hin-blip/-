// テーマのリサーチ（月・木）。
//   ・knowledge の research.yaml のキーワード（5個まで）ごとに GET /2/tweets/search/recent で直近の投稿を読む（リポストは除く）
//   ・読む件数は合計で RESEARCH_MAX_READS（既定150）まで。1件 $0.005（通常料金）。上限は絶対に超えない
//   ・public_metrics（いいね・リポスト・引用・インプレッション）でスコア付けし、上位を claude -p に渡して「今伸びているテーマ」を5〜10個
//   ・他人の投稿の文章・言い回しは、成果物にも knowledge にも書き写さない（テーマの手がかりとしてだけ使う）
//     → AIの出力を機械でも確認し、元の投稿と12字以上一致する部分があるテーマは捨てる
//   ・結果は themes.md の更新案として承認待ちに出す（承認したときだけ反映）
import fs from 'node:fs';
import path from 'node:path';
import { config, localDate } from '../../config.js';
import { usdToJpy } from '../../cost-guard.js';
import { todayApiCost } from '../../db/queries.js';
import { knowledgePathsFor, loadResearchConfig, RESEARCH_START, RESEARCH_END, mergeResearchSection } from '../../knowledge.js';
export { RESEARCH_START, RESEARCH_END, mergeResearchSection };
import { SEARCH_READ_USD, XApiError } from './client.js';
import { xClientForDivision } from './voice.js';

export const TOP_FOR_AI = 30;
export const COPY_NGRAM = 12;

export function maxReads(env = process.env) {
  const n = Number(env.RESEARCH_MAX_READS || 150);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

/**
 * キーワードごとの読む件数（max_results は10〜100）。合計が maxTotal を超えない。
 * 10件ずつも割り振れないときは、先頭のキーワードから使う。
 */
export function planReads(keywords, maxTotal) {
  const usable = Math.min(keywords.length, Math.floor(maxTotal / 10));
  if (usable <= 0) return [];
  const per = Math.min(100, Math.floor(maxTotal / usable));
  return keywords.slice(0, usable).map((keyword) => ({ keyword, maxResults: per }));
}

/** スコア = いいね + リポスト×2 + 引用 + インプレッション÷100 */
export function score(t) {
  const m = t.public_metrics || {};
  return (m.like_count || 0) + 2 * (m.retweet_count || 0) + (m.quote_count || 0) + (m.impression_count || 0) / 100;
}

const norm = (s) => String(s || '').replace(/https?:\/\/\S+/g, '').replace(/&amp;/g, '&').replace(/[\s「」『』"'#@]/g, '');

/** 他人の投稿から N 字の断片を作る（書き写しの検出用） */
export function shingles(texts, n = COPY_NGRAM) {
  const set = new Set();
  for (const t of texts) {
    const a = Array.from(norm(t));
    for (let i = 0; i + n <= a.length; i++) set.add(a.slice(i, i + n).join(''));
  }
  return set;
}

export function copiesFrom(text, set, n = COPY_NGRAM) {
  const a = Array.from(norm(text));
  for (let i = 0; i + n <= a.length; i++) { const g = a.slice(i, i + n).join(''); if (set.has(g)) return g; }
  return null;
}

export function renderResearchSection({ themes, keywords, date, read }) {
  const lines = [RESEARCH_START, `## 今伸びているテーマ（Xリサーチ ${date}・承認済み）`, '',
    `> キーワード: ${keywords.join(' / ')}（直近の投稿 ${read}件をいいね・リポスト・インプレッションでスコア付け）`,
    '> 毎朝の生成は、3本柱に合うものをここから優先して選ぶ。**他人の投稿の文章・言い回しは書き写さない。テーマの手がかりとしてだけ使う。**', ''];
  themes.forEach((t, i) => {
    lines.push(`### ${i + 1}. ${t.name}`, `- なぜ伸びているか: ${t.why}`, `- 自分ならどう書くか: ${t.my_angle}`, '');
  });
  lines.push(RESEARCH_END);
  return lines.join('\n') + '\n';
}

export async function researchThemes({ rec, slug, runClaude, extractJson, fetchImpl, taskId, costDivisionId, env = process.env }) {
  const division = rec.resolveDivision(slug);
  const paths = knowledgePathsFor(slug);
  const { keywords, lang } = loadResearchConfig(paths.research);
  let limit = maxReads(env);

  // 今日のAPIコストの残りで読める件数にも絞る（上限 DAILY_API_COST_LIMIT_JPY）
  if (config.dailyCostLimitJpy != null) {
    const { jpy: perRead } = usdToJpy(SEARCH_READ_USD);
    const remaining = config.dailyCostLimitJpy - todayApiCost(rec.db, localDate());
    const affordable = Math.floor(remaining / perRead);
    if (affordable < limit) {
      rec.log_event({ task_id: taskId, message: `今日のAPIコストの残り（¥${Math.max(0, Math.round(remaining))}）に合わせて、読む件数を ${limit}件 → ${Math.max(0, affordable)}件に減らします` });
      limit = Math.max(0, affordable);
    }
  }
  const plan = planReads(keywords, limit);
  if (!plan.length) return { status: 'skipped', reason: `読める件数が10件未満のためリサーチしません（上限 ${limit}件）` };

  const { account, client } = xClientForDivision(slug, { fetchImpl });
  const tweets = [];
  let read = 0;
  for (const { keyword, maxResults } of plan) {
    if (read + maxResults > limit) break; // 念のため: 上限を超える呼び出しはしない
    const query = `${keyword} lang:${lang} -is:retweet`;
    const got = await client.searchRecent(query, { maxResults });
    read += got.length;
    for (const t of got) tweets.push({ ...t, keyword });
  }
  if (read > limit) throw new Error(`読んだ件数（${read}）が上限（${limit}）を超えました`); // 起きないはず

  const costUsd = Math.round(read * SEARCH_READ_USD * 1e6) / 1e6;
  const { jpy, assumed, rate } = usdToJpy(costUsd);
  if (costUsd > 0) rec.add_metric({ division: costDivisionId, name: 'api_cost_jpy', value: jpy });
  rec.log_event({ task_id: taskId, message: `X（${account.envPrefix}）でキーワード ${plan.length}個（${plan.map((p) => p.keyword).join(' / ')}）を検索し、${read}件を読みました（上限 ${limit}件）。推定費用 $${costUsd.toFixed(3)}（${read}件 × $${SEARCH_READ_USD}）≒ ¥${jpy}${assumed ? `（1ドル=${rate}円で概算）` : ''}` });
  if (read === 0) return { status: 'done', read, costUsd, themes: 0, reason: '検索結果が0件でした' };

  // 重複を除いてスコア順
  const uniq = [...new Map(tweets.map((t) => [String(t.id), t])).values()].sort((a, b) => score(b) - score(a));
  const top = uniq.slice(0, TOP_FOR_AI);
  const prompt = `ジョブ: research（テーマのリサーチ）
あなたは「AI会社」の${division.name}の担当です。以下は **他人の** X の投稿です（キーワード検索の直近の結果を、いいね・リポスト・インプレッションでスコアの高い順に${top.length}件）。

## やること
「今伸びているテーマ」を5〜10個まとめる。各テーマに:
- name: テーマ名（短く。投稿の言い回しを使わない）
- why: なぜ伸びているか（反応の傾向から。1〜2文）
- my_angle: 自分ならどう書くか（このアカウントの3本柱・口調で、何を、どんな型で。1〜2文）

## 絶対のルール
- 他人の投稿の文章・言い回し・キャッチコピーを書き写さない。要約や引用もしない。テーマの手がかりとしてだけ使う。
- 投稿者の名前・アカウント名を書かない。
- 誇大な収益訴求（「誰でも」「必ず」「月◯万」など）に乗らない。
- 数字の実績を作らない。

## 自分のアカウントのテーマ（3本柱）
${paths.themes} を Read で読み、3本柱に合うものを優先する。

## 他人の投稿（手がかりとしてだけ使う）
${top.map((t) => `- [score:${Math.round(score(t))} / いいね ${t.public_metrics?.like_count ?? 0} / RP ${t.public_metrics?.retweet_count ?? 0} / インプ ${t.public_metrics?.impression_count ?? 0} / キーワード: ${t.keyword}] ${norm(t.text).slice(0, 200)}`).join('\n')}

## 出力
最後に次の JSON を \`\`\`json ブロックで1つだけ出す。
{"themes": [{"name": "...", "why": "...", "my_angle": "..."}]}`;

  rec.log_event({ task_id: taskId, message: `上位${top.length}件を手がかりに、今伸びているテーマを claude -p でまとめています` });
  const res = await runClaude({ prompt });
  const ai = extractJson(res.text);

  // 書き写しの検出（元の投稿と12字以上一致したらそのテーマは捨てる）
  const set = shingles(top.map((t) => t.text));
  const themes = [], copied = [];
  for (const t of Array.isArray(ai.themes) ? ai.themes : []) {
    const name = String(t?.name || '').trim(), why = String(t?.why || '').trim(), myAngle = String(t?.my_angle || '').trim();
    if (!name || !why || !myAngle) continue;
    const hit = copiesFrom(`${name}\n${why}\n${myAngle}`, set);
    if (hit) { copied.push(name); continue; }
    themes.push({ name, why, my_angle: myAngle });
  }
  if (copied.length) rec.log_event({ task_id: taskId, message: `他人の投稿の言い回しと一致する部分があったテーマ ${copied.length}件を捨てました（書き写し禁止）` });
  const picked = themes.slice(0, 10);
  if (picked.length < 5) rec.log_event({ task_id: taskId, message: `使えるテーマが ${picked.length}件でした（目安は5〜10件）` });
  if (!picked.length) throw new Error('使えるテーマが1件もありませんでした');

  const date = localDate();
  const section = renderResearchSection({ themes: picked, keywords: plan.map((p) => p.keyword), date, read });
  const dir = path.join(config.outputsDir, slug, date);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `themes-research-${Date.now()}.md`);
  fs.writeFileSync(file, section);
  const outputId = rec.save_output({ task_id: taskId, division: division.id, kind: 'report', file_path: file,
    title: `テーマの更新案（Xリサーチ ${date}・${picked.length}件） → ${paths.themes}`,
    preview_text: picked.map((t) => t.name).join(' / ').slice(0, 160),
    meta: { type: 'themes_update', target_path: paths.themes, division_slug: slug, read, keywords: plan.map((p) => p.keyword) } });
  rec.log_event({ task_id: taskId, message: `承認待ちに出しました: テーマの更新案 ${picked.length}件（承認すると ${paths.themes} の「今伸びているテーマ」を置き換え）` });
  return { status: 'done', read, costUsd, themes: picked.length, copied: copied.length, outputId };
}

export { XApiError };
