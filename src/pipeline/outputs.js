// output/ 配下の完成品の一覧と、投稿状況（status.json）の読み書き。ダッシュボードのAPIからも使う
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './store.js';

export const SLUG_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;

// 状態: ready（投稿待ち）/ needs_review（要確認）/ posted（投稿済み）
export function loadOutput(outputDir, slug) {
  if (!SLUG_RE.test(slug)) return null;
  const dir = path.join(outputDir, slug);
  const meta = readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return null;
  const status = readJson(path.join(dir, 'status.json'), null);
  const xPosts = readJson(path.join(dir, 'x_posts.json'), null);
  const state = status?.status === 'posted' ? 'posted' : meta.review?.final_status === 'needs_review' ? 'needs_review' : 'ready';
  return { slug, dir, meta, status, xPosts, state };
}

export function listOutputs(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SLUG_RE.test(d.name))
    .map((d) => loadOutput(outputDir, d.name))
    .filter(Boolean)
    .sort((a, b) => String(b.meta.created_at).localeCompare(String(a.meta.created_at)));
}

export function recentOutputs(outputDir, days, now = new Date()) {
  const since = now.getTime() - days * 86400000;
  return listOutputs(outputDir).filter((o) => new Date(o.meta.created_at).getTime() >= since);
}

// まだ投稿されていない完成品のX投稿が使っている枠（'YYYY-MM-DD HH:mm'）
export function occupiedSlots(outputDir) {
  return listOutputs(outputDir)
    .filter((o) => o.state !== 'posted')
    .flatMap((o) => (o.xPosts?.posts || []).map((p) => p.slot).filter(Boolean));
}

const isUrl = (s) => /^https?:\/\/[^\s]+$/.test(s);
const METRIC_KEYS = ['note_pv', 'note_likes', 'purchases', 'x_impressions', 'x_profile_clicks', 'x_link_clicks'];

// ダッシュボードからの更新。URLと数値だけを受け付ける
export function saveStatus(outputDir, slug, input) {
  const item = loadOutput(outputDir, slug);
  if (!item) throw new Error('完成品が見つかりません');
  const next = { ...(item.status || {}) };
  if (input.status !== undefined) {
    if (!['posted', 'unposted'].includes(input.status)) throw new Error('status は posted か unposted です');
    next.status = input.status === 'posted' ? 'posted' : undefined;
    next.posted_at = input.status === 'posted' ? next.posted_at || new Date().toISOString() : undefined;
  }
  if (input.note_url !== undefined) {
    const url = String(input.note_url).trim();
    if (url && !isUrl(url)) throw new Error('noteのURLが正しくありません');
    next.note_url = url || undefined;
  }
  if (input.x_urls !== undefined) {
    const urls = (Array.isArray(input.x_urls) ? input.x_urls : String(input.x_urls).split(/\s+/)).map((u) => String(u).trim()).filter(Boolean);
    const bad = urls.find((u) => !isUrl(u));
    if (bad) throw new Error(`XのURLが正しくありません: ${bad}`);
    next.x_urls = urls;
  }
  if (input.metrics !== undefined) {
    next.metrics = Object.fromEntries(
      METRIC_KEYS.filter((k) => input.metrics[k] !== undefined && input.metrics[k] !== '').map((k) => {
        const n = Number(input.metrics[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${k} は0以上の数値で入力してください`);
        return [k, n];
      }),
    );
  }
  next.updated_at = new Date().toISOString();
  writeJsonAtomic(path.join(item.dir, 'status.json'), JSON.parse(JSON.stringify(next)));
  return loadOutput(outputDir, slug);
}
