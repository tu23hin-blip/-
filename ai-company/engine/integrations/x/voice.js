// 口調の自動作成と実績の候補抽出（初回だけ）。
//   ・自分の過去の投稿を最大200件（リポストと返信を除く）、GET /2/users/{自分のid}/tweets で読む（Owned Reads: 1件 $0.001）
//   ・インプレッション上位20件を「お手本」に、口調の特徴（文の長さ・語尾・書き出し・改行・絵文字）と一緒に claude -p にまとめさせる
//   ・口調は voice の下書き、実績は1項目ずつ「候補」として承認待ちに出す（承認したときだけ knowledge に書く）
//   ・実績の候補は、元の投稿にその文言が本当にあるものだけを残す（AIが作った数字を混ぜない）
import fs from 'node:fs';
import path from 'node:path';
import { config, localDate } from '../../config.js';
import { usdToJpy } from '../../cost-guard.js';
import { knowledgePathsFor, readKnowledge } from '../../knowledge.js';
import { createXClient, OWNED_READ_USD, XApiError } from './client.js';
import { loadAccounts, credsFor, ownUser } from './import.js';

export const HISTORY_LIMIT = 200;
export const SAMPLE_COUNT = 20;
const EMOJI = /\p{Extended_Pictographic}/gu;      // 数える用
const HAS_EMOJI = /\p{Extended_Pictographic}/u;  // 有無を調べる用（g を付けると test がずれる）
const stripUrls = (t) => String(t || '').replace(/https?:\/\/\S+/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** その部門に使う X アカウント（x-accounts.yaml） */
export function accountForDivision(slug) {
  const acc = loadAccounts().find((a) => a.divisions.includes(slug));
  if (!acc) throw new XApiError(`engine/integrations/x-accounts.yaml に部門 ${slug} のアカウントがありません`, { retryable: false });
  return acc;
}

export function xClientForDivision(slug, { fetchImpl, env = process.env } = {}) {
  const account = accountForDivision(slug);
  const creds = credsFor(account.envPrefix, env);
  if (!creds) throw new XApiError(`${account.envPrefix} のキーが .env に入っていません（${account.envPrefix}_API_KEY など4つ）`, { retryable: false });
  return { account, creds, client: createXClient(creds, { fetchImpl, envPrefix: account.envPrefix }) };
}

/** 口調の特徴を数える（AIに任せず、プログラムで数える） */
export function voiceStats(tweets) {
  const texts = tweets.map((t) => stripUrls(t.text)).filter(Boolean);
  const n = texts.length || 1;
  const lens = texts.map((t) => Array.from(t).length).sort((a, b) => a - b);
  const count = (arr) => { const m = new Map(); for (const x of arr) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const sentences = texts.flatMap((t) => t.split(/[。！？!?\n]+/).map((x) => x.trim()).filter((x) => Array.from(x).length >= 4));
  const endings = count(sentences.map((x) => Array.from(x.replace(/[\s、,.・）)」』]+$/u, '')).slice(-3).join(''))).slice(0, 8);
  const openings = count(texts.map((t) => Array.from(t.split('\n')[0]).slice(0, 4).join(''))).slice(0, 8);
  const pct = (k) => Math.round((k / n) * 100);
  return {
    posts: texts.length,
    length: { median: lens[Math.floor(lens.length / 2)] ?? 0, min: lens[0] ?? 0, max: lens.at(-1) ?? 0 },
    avg_line_breaks: Math.round((texts.reduce((s, t) => s + (t.match(/\n/g) || []).length, 0) / n) * 10) / 10,
    emoji_posts_pct: pct(texts.filter((t) => HAS_EMOJI.test(t)).length),
    emoji_per_post: Math.round((texts.reduce((s, t) => s + (t.match(EMOJI) || []).length, 0) / n) * 10) / 10,
    starts_with_number_pct: pct(texts.filter((t) => /^[\d０-９]/.test(t)).length),
    first_line_question_pct: pct(texts.filter((t) => /[？?]$/.test(t.split('\n')[0].trim())).length),
    hashtag_per_post: Math.round((texts.reduce((s, t) => s + (t.match(/#[^\s#]+/g) || []).length, 0) / n) * 10) / 10,
    common_endings: endings.map(([k, v]) => `${k}（${v}回）`),
    common_openings: openings.map(([k, v]) => `${k}…（${v}回）`),
  };
}

export function topByImpressions(tweets, k = SAMPLE_COUNT) {
  return [...tweets].sort((a, b) => (b.public_metrics?.impression_count ?? -1) - (a.public_metrics?.impression_count ?? -1)).slice(0, k);
}

/** AIの実績候補のうち、元の投稿に引用文が本当にあるものだけ残す */
export function verifyCandidates(candidates, tweetsById) {
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  const kept = [], dropped = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const t = tweetsById.get(String(c?.source_id || ''));
    const quote = norm(c?.quote);
    if (t && c?.text && Array.from(quote).length >= 4 && norm(stripUrls(t.text)).includes(quote)) kept.push({ ...c, tweet: t });
    else dropped.push(c);
  }
  return { kept, dropped };
}

function renderVoice({ ai, samples, stats, username, division }) {
  const lines = [`# 口調・文体（${division.name}${username ? ` / @${username}` : ''}）`, '',
    `> X の過去の投稿 ${stats.posts}件（リポスト・返信を除く）から自動で作った下書きを、承認して反映したものです（${localDate()}）。`,
    '> 気になるところは自由に書き直してください。', ''];
  lines.push(String(ai.voice_markdown || '').trim(), '');
  lines.push('## 数で見た特徴（プログラムで集計）', '',
    `- 文字数: 中央値 ${stats.length.median}字（${stats.length.min}〜${stats.length.max}字）`,
    `- 改行: 1投稿あたり平均 ${stats.avg_line_breaks} 回`,
    `- 絵文字: ${stats.emoji_posts_pct}% の投稿で使用（1投稿あたり平均 ${stats.emoji_per_post} 個）`,
    `- 数字で始まる投稿: ${stats.starts_with_number_pct}% ／ 1行目が問いかけ: ${stats.first_line_question_pct}%`,
    `- ハッシュタグ: 1投稿あたり平均 ${stats.hashtag_per_post} 個`,
    `- よく使う語尾: ${stats.common_endings.join('、') || '—'}`,
    `- よく使う書き出し: ${stats.common_openings.join('、') || '—'}`, '');
  lines.push('## この会社のルール（変えない）', '',
    '- X投稿の文末に「※AI生成」を入れる',
    '- 「誰でも」「必ず」「放置で」「月◯万」などの誇大表現は使わない',
    '- 実績・数字は experience（my-experience.md）にあるものだけを使う', '');
  lines.push(`## お手本（インプレッション上位${samples.length}件・自分の投稿）`, '');
  samples.forEach((t, i) => {
    lines.push(`### ${i + 1}. インプ ${t.public_metrics?.impression_count?.toLocaleString('ja-JP') ?? '不明'}（${t.created_at ? localDate(new Date(t.created_at)) : '日付不明'}）`, '', stripUrls(t.text), '');
  });
  return lines.join('\n') + '\n';
}

function writeDraft(slug, name, body) {
  const dir = path.join(config.outputsDir, slug, localDate());
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, body);
  return f;
}

/**
 * @returns {{status, read, costUsd, voiceOutputId, candidates, dropped}}
 */
export async function buildVoice({ rec, slug, runClaude, extractJson, fetchImpl, force = false, taskId, costDivisionId }) {
  const division = rec.resolveDivision(slug);
  const paths = knowledgePathsFor(slug);
  const doneKey = `voice_built:${slug}`;
  if (!force && rec.get_meta(doneKey)) {
    return { status: 'skipped', reason: `${division.name} の口調づくりは実行済みです（${rec.get_meta(doneKey)}）。やり直すなら --force` };
  }
  const { account, creds, client } = xClientForDivision(slug, { fetchImpl });
  const user = await ownUser(rec, client, account.envPrefix, creds);
  rec.log_event({ task_id: taskId, message: `X（${account.envPrefix}${user.username ? ` @${user.username}` : ''}）の過去の投稿を最大${HISTORY_LIMIT}件読みます（リポスト・返信を除く）` });
  const tweets = await client.getOwnHistory(user.id, { limit: HISTORY_LIMIT });

  // 推定費用（Owned Reads）
  const costUsd = Math.round(tweets.length * OWNED_READ_USD * 1e6) / 1e6;
  const { jpy, assumed, rate } = usdToJpy(costUsd);
  if (costUsd > 0) rec.add_metric({ division: costDivisionId ?? division.id, name: 'api_cost_jpy', value: jpy });
  rec.log_event({ task_id: taskId, message: `X から自分の投稿 ${tweets.length}件を読みました。推定費用 $${costUsd.toFixed(3)}（${tweets.length}件 × $${OWNED_READ_USD}・Owned Reads）≒ ¥${jpy}${assumed ? `（1ドル=${rate}円で概算）` : ''}` });
  if (tweets.length === 0) throw new XApiError('読める投稿が1件もありませんでした（リポスト・返信を除く）', { retryable: false });

  const stats = voiceStats(tweets);
  const samples = topByImpressions(tweets);
  const byId = new Map(tweets.map((t) => [String(t.id), t]));
  const currentVoice = readKnowledge(paths.voice);
  const prompt = `ジョブ: voice（口調の自動作成と実績の候補抽出）
あなたは「AI会社」の${division.name}の担当です。以下は **このアカウント本人の** X の投稿です（他人の投稿ではありません）。

## やること
1. お手本（インプレッション上位${samples.length}件）と、プログラムで数えた特徴を読み、このアカウントの口調を Markdown でまとめる（voice_markdown）。
   見出しは「## 基本」「## X投稿の型」「## 避けること」。文の長さ、語尾、書き出し、改行、絵文字の使い方を、具体的に、短く書く。
   お手本の文章そのものは貼らない（エンジンが別に付ける）。
2. 全投稿（${tweets.length}件）から、実績・経験・数字に当たる記述を抜き出す（experience_candidates）。
   - text: experience に書く1行（「いつ・何をして・どうなったか」。投稿に書かれていないことは足さない）
   - source_id: 元の投稿の id
   - quote: 元の投稿からそのまま写した根拠の文言（10〜40字。言い換えない）
   - 投稿に書かれていない数字や推測は絶対に入れない。見込み・目標・他人の実績・一般論は実績ではないので入れない。
   - なければ空配列。多くても15件まで。

## プログラムで数えた特徴
\`\`\`json
${JSON.stringify(stats, null, 1)}
\`\`\`

## お手本（インプレッション上位${samples.length}件）
${samples.map((t) => `- [id:${t.id}] (インプ ${t.public_metrics?.impression_count ?? '不明'}) ${stripUrls(t.text).replace(/\n/g, ' / ')}`).join('\n')}

## 全投稿（実績の抜き出し用）
${tweets.map((t) => `- [id:${t.id}] ${stripUrls(t.text).replace(/\n/g, ' / ')}`).join('\n')}

${currentVoice ? `## いまの口調ファイル（参考）\n${currentVoice.slice(0, 2000)}\n` : ''}
## 出力
最後に次の JSON を \`\`\`json ブロックで1つだけ出す。
{"voice_markdown": "## 基本\\n- ...", "experience_candidates": [{"text": "...", "source_id": "123", "quote": "..."}]}`;

  rec.log_event({ task_id: taskId, message: '口調のまとめと実績の候補抽出を claude -p で実行中' });
  const res = await runClaude({ prompt });
  const ai = extractJson(res.text);
  if (!String(ai.voice_markdown || '').trim()) throw new Error('AIの返答に口調のまとめ（voice_markdown）がありません');

  // 口調の下書き → 承認待ち（承認したときだけ上書き）
  const body = renderVoice({ ai, samples, stats, username: user.username, division });
  const voiceFile = writeDraft(slug, `voice-${Date.now()}.md`, body);
  const voiceOutputId = rec.save_output({ task_id: taskId, division: division.id, kind: 'report', file_path: voiceFile,
    title: `口調の下書き → ${paths.voice}`, preview_text: String(ai.voice_markdown).slice(0, 160),
    meta: { type: 'voice_update', target_path: paths.voice, division_slug: slug, read: tweets.length, samples: samples.length } });

  // 実績の候補 → 1項目ずつ承認待ち（承認されたものだけ experience に追記）
  const { kept, dropped } = verifyCandidates(ai.experience_candidates, byId);
  const urlOf = (id) => (user.username ? `https://x.com/${user.username}/status/${id}` : `https://x.com/i/web/status/${id}`);
  for (const c of kept.slice(0, 15)) {
    const date = c.tweet.created_at ? localDate(new Date(c.tweet.created_at)) : null;
    const url = urlOf(c.tweet.id);
    const line = `${String(c.text).replace(/\s+/g, ' ').trim()}（${date ? `${date}の` : ''}投稿: ${url}）`;
    const f = writeDraft(slug, `experience-${c.tweet.id}-${Date.now()}.md`,
      `# 実績の候補（${division.name}）\n\n承認すると ${paths.experience} に次の1行を追記します。\n\n- ${line}\n\n## 根拠（自分の投稿）\n\n> ${c.quote}\n\n${url}\n`);
    rec.save_output({ task_id: taskId, division: division.id, kind: 'report', file_path: f,
      title: `実績の候補: ${String(c.text).slice(0, 30)}`, preview_text: line.slice(0, 160),
      meta: { type: 'experience_candidate', target_path: paths.experience, division_slug: slug, line, quote: c.quote, source_url: url } });
  }
  if (dropped.length) rec.log_event({ task_id: taskId, message: `実績の候補のうち ${dropped.length}件は、元の投稿に根拠の文言が見つからないため捨てました` });
  rec.set_meta(doneKey, localDate());
  rec.log_event({ task_id: taskId, message: `承認待ちに出しました: 口調の下書き1件・実績の候補${Math.min(kept.length, 15)}件（${paths.voice} / ${paths.experience}）` });
  return { status: 'done', read: tweets.length, costUsd, voiceOutputId, candidates: Math.min(kept.length, 15), dropped: dropped.length };
}
