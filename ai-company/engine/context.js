// Skill に渡す「エンジンからの情報」を DB から作る。division.yaml の jobs.<job>.context で選ぶ。
//   recent_themes / post_reactions / rejections / latest_report / top_posts:<slug> / division_metrics
import { config, localDate, addDays } from './config.js';
import { latestReport, readOutputFile } from './db/queries.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
const short = (s, n = 90) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

function recentThemes(db, div) {
  const rows = db.prepare(`SELECT created_at, kind, meta FROM outputs WHERE division_id = ? AND created_at >= ? ORDER BY created_at DESC`).all(div.id, since(14));
  const seen = new Map();
  for (const r of rows) {
    const t = parse(r.meta).theme;
    const d = localDate(new Date(r.created_at));
    if (t && !seen.has(`${d}|${t}`)) seen.set(`${d}|${t}`, `- ${d}: ${t}（${r.kind}）`);
  }
  return `### 直近14日に使ったテーマ\n${[...seen.values()].join('\n') || '- （まだありません）'}`;
}

function postStats(db, divisionId, days) {
  return db.prepare(`SELECT o.id, o.title, o.kind, o.meta, o.preview_text, o.published_url, o.created_at,
      SUM(CASE WHEN m.name = 'impressions' THEN m.value END) imp,
      SUM(CASE WHEN m.name = 'clicks' THEN m.value END) clk
    FROM outputs o LEFT JOIN metrics m ON m.output_id = o.id
    WHERE o.division_id = ? AND o.created_at >= ? AND o.approval = 'approved' AND o.kind != 'report'
    GROUP BY o.id ORDER BY imp DESC NULLS LAST, o.created_at DESC`).all(divisionId, since(days));
}

function postReactions(db, div) {
  const rows = postStats(db, div.id, 14);
  const withData = rows.filter((r) => r.imp != null || r.clk != null);
  if (!withData.length) {
    return `### 投稿ごとの反応（直近14日）\n- 投稿ごとの数字はまだありません（数字は捏造せず、承認された投稿の傾向だけで判断してください）\n` +
      `- 承認済みの投稿: ${rows.length}件${rows.length ? '\n' + rows.slice(0, 10).map((r) => `  - ${parse(r.meta).theme || '?'}: ${short(r.preview_text, 60)}`).join('\n') : ''}`;
  }
  return `### 投稿ごとの反応（直近14日・インプレッション順）\n` + withData.slice(0, 15).map((r) =>
    `- テーマ: ${parse(r.meta).theme || '?'} / インプ: ${r.imp ?? '不明'} / クリック: ${r.clk ?? '不明'} / ${short(r.preview_text, 60)}`).join('\n');
}

function rejections(db, div) {
  const rows = db.prepare(`SELECT title, meta, preview_text FROM outputs WHERE division_id = ? AND approval = 'rejected' AND created_at >= ? ORDER BY created_at DESC LIMIT 10`).all(div.id, since(30));
  const lines = rows.map((r) => {
    const c = (parse(r.meta).comments || []).map((x) => x.text).join(' / ');
    return `- ${r.title || short(r.preview_text, 40)}${c ? ` → 人間のコメント: ${c}` : '（コメントなし）'}`;
  });
  return `### 最近却下された下書き（同じ失敗をしない）\n${lines.join('\n') || '- （ありません）'}`;
}

function latestReportCtx(db) {
  const r = latestReport(db);
  if (!r) return '### 最新の週次レポート\n- （まだありません）';
  const text = readOutputFile(r.file_path);
  return `### 最新の週次レポート（${r.title}）\n${text ? text.slice(0, 3000) : `ファイル: ${r.file_path}`}`;
}

function topPosts(db, slug) {
  const src = db.prepare('SELECT * FROM divisions WHERE slug = ?').get(slug);
  if (!src) return `### ${slug} で伸びたテーマ\n- （その事業部がありません）`;
  const rows = postStats(db, src.id, 14);
  const byTheme = new Map();
  for (const r of rows) {
    const t = parse(r.meta).theme || '（テーマ不明）';
    const cur = byTheme.get(t) || { theme: t, imp: null, n: 0, sample: r.preview_text };
    cur.n++; if (r.imp != null) cur.imp = (cur.imp ?? 0) + r.imp;
    byTheme.set(t, cur);
  }
  const list = [...byTheme.values()].sort((a, b) => (b.imp ?? -1) - (a.imp ?? -1) || b.n - a.n);
  const hasData = list.some((x) => x.imp != null);
  return `### ${src.name}で伸びたテーマ（直近14日${hasData ? '・インプレッション順' : '・反応データなしのため承認数順'}）\n` +
    (list.slice(0, 8).map((x) => `- ${x.theme} / 承認 ${x.n}件 / インプ ${x.imp ?? '不明'} / 例: ${short(x.sample, 60)}`).join('\n') || '- （まだありません）');
}

function divisionMetrics(db, div) {
  const today = localDate();
  const rows = db.prepare(`SELECT name, SUM(value) s, COUNT(value) c FROM metrics WHERE division_id = ? AND output_id IS NULL AND date BETWEEN ? AND ? GROUP BY name`)
    .all(div.id, addDays(today, -6), today);
  return `### この事業部の直近7日の数字\n${rows.map((r) => `- ${r.name}: ${r.c ? r.s : '不明'}`).join('\n') || '- （記録なし）'}`;
}

export function buildContext(db, div, keys = []) {
  const parts = [];
  for (const k of keys) {
    if (k === 'recent_themes') parts.push(recentThemes(db, div));
    else if (k === 'post_reactions') parts.push(postReactions(db, div));
    else if (k === 'rejections') parts.push(rejections(db, div));
    else if (k === 'latest_report') parts.push(latestReportCtx(db));
    else if (k === 'division_metrics') parts.push(divisionMetrics(db, div));
    else if (k.startsWith('top_posts:')) parts.push(topPosts(db, k.split(':')[1]));
  }
  return parts.join('\n\n');
}

export { config };
