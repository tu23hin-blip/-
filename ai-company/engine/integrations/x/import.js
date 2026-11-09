// X の投稿の数字を取り込む（1日1回）。
// お金を節約する決まり:
//   ・自分の投稿は GET /2/users/{自分のid}/tweets だけで読む（Owned Reads: 1件 $0.001）
//   ・自分のユーザーIDは /2/users/me で1回だけ取り、app_meta に保存して使い回す
//   ・読む範囲は「今から X_FETCH_DAYS 日前（既定3日）」以降だけ。古い投稿は最後に取った値のまま
//   ・同じ日に2回目は呼ばない（--force のときだけ）
// 保存: 投稿ごとに1行（最新の累計値）で上書き。metrics.date は投稿日で固定。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { config, localDate } from '../../config.js';
import { readOutputFile } from '../../db/queries.js';
import { usdToJpy } from '../../cost-guard.js';
import { createXClient, OWNED_READ_USD, XApiError } from './client.js';

export const ACCOUNTS_FILE = path.join(config.root, 'engine/integrations/x-accounts.yaml');
const KEY_SUFFIXES = { apiKey: 'API_KEY', apiSecret: 'API_SECRET', accessToken: 'ACCESS_TOKEN', accessTokenSecret: 'ACCESS_TOKEN_SECRET' };
const parseMeta = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

export function loadAccounts(file = process.env.X_ACCOUNTS_FILE || ACCOUNTS_FILE) {
  const y = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  return (y.accounts || []).map((a) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(a.env_prefix || '')) throw new Error(`x-accounts.yaml: env_prefix が不正です（${a.env_prefix}）`);
    return { envPrefix: a.env_prefix, divisions: [].concat(a.divisions || []).map(String) };
  });
}

/** .env からキーを読む。1つでも空なら null（= スキップ） */
export function credsFor(envPrefix, env = process.env) {
  const creds = {};
  for (const [k, suffix] of Object.entries(KEY_SUFFIXES)) {
    const v = (env[`${envPrefix}_${suffix}`] || '').trim();
    if (!v) return null;
    creds[k] = v;
  }
  return creds;
}

export function fetchDays(env = process.env) {
  const n = Number(env.X_FETCH_DAYS || 3);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.round(n))) : 3;
}

/** 投稿URLから投稿IDを取り出す */
export function tweetIdFromUrl(url) {
  return String(url || '').match(/\/status(?:es)?\/(\d+)/)?.[1] || null;
}

/** 照合用: HTML実体参照を戻し、URL（X では t.co に変わる）と空白を除いた先頭 n 字 */
export function headKey(text, n = 40) {
  const s = String(text || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, '');
  return Array.from(s).slice(0, n).join('');
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);

/** 自分のユーザーID（保存済みならそれを使う。アクセストークンが変わったときだけ取り直す） */
export async function ownUser(rec, client, envPrefix, creds) {
  const key = `x_user:${envPrefix}`;
  const hash = tokenHash(creds.accessToken);
  let cached = null;
  try { cached = JSON.parse(rec.get_meta(key) || 'null'); } catch { cached = null; }
  if (cached?.id && cached.token_hash === hash) return { ...cached, fetched: false };
  const me = await client.getMe();
  rec.set_meta(key, JSON.stringify({ id: me.id, username: me.username, token_hash: hash, at: new Date().toISOString() }));
  return { ...me, fetched: true };
}

/**
 * 1アカウント分を取り込む。
 * @returns {{status:'done'|'skipped', reason?, read?, updated?, linked?, costUsd?}}
 */
export async function importAccount({ rec, account, env = process.env, fetchImpl, now = new Date(), force = false, taskId = null }) {
  const { envPrefix } = account;
  const creds = credsFor(envPrefix, env);
  if (!creds) return { status: 'skipped', reason: `${envPrefix} のキーが空のためスキップ` };

  const divisions = account.divisions.map((slug) => rec.db.prepare('SELECT * FROM divisions WHERE slug = ?').get(slug)).filter(Boolean);
  const missing = account.divisions.filter((slug) => !divisions.some((d) => d.slug === slug));
  if (!divisions.length) return { status: 'skipped', reason: `${envPrefix}: 部門（${account.divisions.join(', ')}）が未登録のためスキップ（APIは呼んでいません）` };

  const today = localDate(now);
  const lastKey = `x_last_fetch:${envPrefix}`;
  if (!force && rec.get_meta(lastKey) === today) return { status: 'skipped', reason: `${envPrefix}: 今日はすでに取り込み済み（1日1回まで。やり直すなら --force）` };

  const client = createXClient(creds, { fetchImpl, envPrefix });
  const user = await ownUser(rec, client, envPrefix, creds);
  const days = fetchDays(env);
  const startTime = new Date(now.getTime() - days * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const { tweets, nextToken } = await client.getOwnTweets(user.id, { startTime, maxResults: 100 });

  const divIds = divisions.map((d) => d.id);
  const ph = divIds.map(() => '?').join(',');
  // 投稿IDでひも付け（published_url の /status/123 から）
  const linkedOutputs = rec.db.prepare(`SELECT id, published_url FROM outputs WHERE division_id IN (${ph}) AND published_url IS NOT NULL`).all(...divIds);
  const byTweetId = new Map();
  for (const o of linkedOutputs) { const id = tweetIdFromUrl(o.published_url); if (id) byTweetId.set(id, o.id); }
  // URL 未登録の「承認済み・未投稿」の X投稿（本文の先頭40字で照合する候補）
  const candidates = rec.db.prepare(`SELECT * FROM outputs WHERE division_id IN (${ph}) AND approval = 'approved'
    AND published_url IS NULL AND kind = 'x_post'`).all(...divIds)
    .map((o) => ({ o, key: headKey(readOutputFile(o.file_path) ?? o.preview_text) }))
    .filter((c) => Array.from(c.key).length >= 10);

  let updated = 0, linked = 0, unmatched = 0, ambiguous = 0;
  const firstDiv = divisions[0];
  for (const t of tweets) {
    let outputId = byTweetId.get(String(t.id));
    if (!outputId) {
      const key = headKey(t.text);
      const hits = candidates.filter((c) => c.key === key);
      if (hits.length === 1) {
        const o = hits[0].o;
        const url = user.username ? `https://x.com/${user.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`;
        rec.link_published(o.id, url, { publishedAt: t.created_at || now.toISOString(),
          message: `X の投稿と自動でひも付けて投稿済みにしました（本文の先頭40字が一致）: ${o.title || o.kind} → ${url}` });
        candidates.splice(candidates.indexOf(hits[0]), 1);
        outputId = o.id;
        linked++;
      } else {
        if (hits.length > 1) {
          ambiguous++;
          rec.log_event({ division: firstDiv.id, task_id: taskId, message: `X の投稿 ${t.id} は本文の先頭40字が一致する下書きが${hits.length}件あるため、自動でひも付けませんでした（承認待ちタブで投稿URLを登録してください）` });
        } else unmatched++;
        continue;
      }
    }
    const postDate = t.created_at ? localDate(new Date(t.created_at)) : null;
    const imp = t.public_metrics?.impression_count;
    const clk = t.non_public_metrics?.url_link_clicks;
    if (imp != null) rec.upsert_post_metric({ output_id: outputId, name: 'impressions', value: imp, date: postDate });
    if (clk != null) rec.upsert_post_metric({ output_id: outputId, name: 'clicks', value: clk, date: postDate }); // 取れなければ空のまま
    updated++;
  }

  // 推定費用 = 読んだ件数 × $0.001（Owned Reads）。APIコストとして記録（1日の上限の計算にも入る）
  const costUsd = Math.round(tweets.length * OWNED_READ_USD * 1e6) / 1e6;
  const { jpy, assumed, rate } = usdToJpy(costUsd);
  if (costUsd > 0) rec.add_metric({ date: today, division: account.costDivision ?? firstDiv.id, name: 'api_cost_jpy', value: jpy });
  rec.set_meta(lastKey, today);
  rec.log_event({ division: account.costDivision ?? firstDiv.id, task_id: taskId, message:
    `X（${envPrefix}${user.username ? ` @${user.username}` : ''}）から ${days}日分の投稿 ${tweets.length}件を読みました。推定費用 $${costUsd.toFixed(3)}（${tweets.length}件 × $${OWNED_READ_USD}）≒ ¥${jpy}` +
    `${assumed ? `（1ドル=${rate}円で概算）` : ''}／数字を更新 ${updated}件・自動ひも付け ${linked}件・対象外 ${unmatched}件` +
    `${ambiguous ? `・候補が複数 ${ambiguous}件` : ''}${user.fetched ? '／自分のユーザーIDを /2/users/me で取得して保存しました' : ''}` +
    `${missing.length ? `／未登録の部門 ${missing.join(', ')} は対象外` : ''}${nextToken ? '／100件を超えた分は読んでいません' : ''}` });
  return { status: 'done', read: tweets.length, updated, linked, unmatched, ambiguous, costUsd, calls: client.calls };
}

export { XApiError };
