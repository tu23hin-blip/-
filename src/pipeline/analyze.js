// npm run analyze … 週1回の分析。勝ちパターンDBを更新し、ジャンルの継続/撤退を判定して data/genres.json に反映する
import fs from 'node:fs';
import path from 'node:path';
import { extractPatterns, insights } from '../editorial/engine.js';
import { LLM } from './llm.js';
import { fmtUsd } from './cost.js';
import { Store } from './store.js';
import { listOutputs } from './outputs.js';
import { todayIn, daysBetween, addDays } from './time.js';
import { createCost } from './produce.js';
import { mixFromPatterns } from './steps/xposts.js';

const DIMENSIONS = ['genre', 'article_type', 'price', 'eyecatch_layout'];

// 投稿済みの完成品から、記事ごとの実績を作る（数値はダッシュボードで入力したもの）
export function performanceRecords(outputs) {
  return outputs
    .filter((o) => o.state === 'posted')
    .map((o) => {
      const m = o.status?.metrics || {};
      return {
        slug: o.slug,
        title: o.meta.title,
        genre: o.meta.genre.genre_id,
        article_type: o.meta.idea?.article_type || 'unknown',
        price: o.meta.price_yen || 0,
        eyecatch_layout: o.meta.eyecatch?.layout || 'none',
        posted_at: o.status?.posted_at || o.meta.created_at,
        x_posts: (o.status?.x_urls || []).length,
        impressions: m.x_impressions || 0,
        profileVisits: m.x_profile_clicks || 0,
        linkClicks: m.x_link_clicks || 0,
        noteViews: m.note_pv || 0,
        likes: m.note_likes || 0,
        purchases: m.purchases || 0,
      };
    });
}

export function genreStats(genres, records, today) {
  return genres
    .filter((g) => g.status !== 'retired')
    .map((g) => {
      const rows = records.filter((r) => r.genre === g.genre_id);
      const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
      const daysElapsed = g.test_started_at ? daysBetween(g.test_started_at, today) : null;
      const testDays = g.test_plan?.days ?? 14;
      const actual = {
        note_pv: sum('noteViews'),
        x_profile_clicks: sum('profileVisits'),
        paid_sales: rows.filter((r) => r.price > 0).reduce((s, r) => s + r.purchases, 0),
        free_notes: rows.filter((r) => r.price === 0).length,
        paid_notes: rows.filter((r) => r.price > 0).length,
        x_posts: sum('x_posts'),
      };
      const c = g.success_criteria || {};
      const meets = ['note_pv', 'x_profile_clicks', 'paid_sales'].every((k) => c[k] === undefined || actual[k] >= c[k]);
      return {
        genre_id: g.genre_id, name: g.name, status: g.status,
        days_elapsed: daysElapsed, test_days: testDays, test_ended: g.status === 'testing' && daysElapsed !== null && daysElapsed >= testDays,
        test_plan: g.test_plan, success_criteria: c, actual, meets_criteria: meets,
      };
    });
}

// AIの判定を、状態遷移のルールに照らして反映する
export function applyGenreDecisions(genres, decisions, stats, today) {
  const log = [];
  const next = genres.map((g) => ({ ...g }));
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const g = next.find((x) => x.genre_id === d.genre_id);
    const st = stats.find((s) => s.genre_id === d.genre_id);
    if (!g || !st) continue;
    if (d.decision === 'promote') {
      if (g.status === 'testing' && st.test_ended) {
        Object.assign(g, { status: 'active', promoted_at: today, decision_reason: d.reason });
        log.push(`↑ ${g.genre_id} を active にしました（${d.reason}）`);
      } else log.push(`・${g.genre_id} の昇格は見送り（検証期間中、または testing ではありません）`);
    } else if (d.decision === 'retire') {
      if (g.status === 'active' || st.test_ended) {
        Object.assign(g, { status: 'retired', retired_at: today, retired_reason: d.reason, lesson: d.lesson || '' });
        log.push(`↓ ${g.genre_id} を retired にしました（${d.reason}）`);
      } else log.push(`・${g.genre_id} の撤退は見送り（検証期間中のため）`);
    } else if (d.decision === 'extend_test' && g.status === 'testing') {
      g.test_plan = { ...(g.test_plan || {}), days: (g.test_plan?.days ?? 14) + 7 };
      g.decision_reason = d.reason;
      log.push(`→ ${g.genre_id} の検証を7日延長しました（${d.reason}）`);
    }
  }
  return { genres: next, log };
}

export function mergePatterns(current, out, today) {
  const retire = new Set(out.retire_patterns || []);
  const incoming = (Array.isArray(out.winning_patterns) ? out.winning_patterns : []).filter((p) => p?.text).map((p) => ({ ...p, updated_at: today }));
  const merge = (old, fresh) => {
    const byText = new Map(old.filter((p) => !retire.has(p.text)).map((p) => [p.text, p]));
    fresh.forEach((p) => byText.set(p.text, p));
    return [...byText.values()].slice(-20);
  };
  const mix = out.x_mix ? mixFromPatterns({ x_mix: out.x_mix }) : null;
  return {
    ...current,
    updated_at: today,
    patterns: merge(current.patterns || [], incoming.filter((p) => p.dimension !== 'eyecatch')),
    eyecatch_patterns: merge(current.eyecatch_patterns || [], incoming.filter((p) => p.dimension === 'eyecatch')),
    x_mix: mix ? Object.fromEntries(mix.map((m) => [m.key, m.ratio])) : current.x_mix,
    next_week_experiments: out.next_week_experiments || [],
  };
}

export async function analyze({ config, log = console.log, now = new Date() }) {
  const store = new Store(config.paths.data);
  const cost = createCost(config, log);
  const llm = await LLM.create(config, { cost, log });
  const today = todayIn(config.timezone, now);
  const since = addDays(today, -7);
  const records = performanceRecords(listOutputs(config.paths.output));
  const genres = store.genres();
  const stats = genreStats(genres, records, today);
  const patterns = store.patterns();
  const auto = insights(extractPatterns(records, DIMENSIONS));
  log(`AI編集部：週次分析（投稿済み ${records.length}本、うち直近7日 ${records.filter((r) => r.posted_at.slice(0, 10) >= since).length}本）`);

  const out = await llm.run('analyst', {
    performance_json: records,
    auto_patterns: auto.map(({ dimension, value, text, note, samples }) => ({ dimension, value, text, note, samples })),
    genre_stats: stats,
    winning_patterns: patterns.patterns,
    x_mix: patterns.x_mix || 'value 0.5 / experiment 0.2 / opinion 0.2 / cta 0.1（初期値）',
  });

  const applied = applyGenreDecisions(genres, out.genre_decisions, stats, today);
  store.saveGenres(applied.genres);
  store.savePatterns(mergePatterns(patterns, out, today));

  const report = [
    `# 週次分析 ${today}`, '',
    out.summary || '', '',
    '## 勝ちパターン', ...(out.winning_patterns || []).map((p) => `- ${p.text}（${p.evidence || '根拠なし'}・確度 ${p.confidence || '-'}）`), '',
    '## ジャンルの判定', ...applied.log.map((l) => `- ${l}`), ...(out.genre_decisions || []).map((d) => `- ${d.genre_id}: ${d.decision}（${d.reason}）`), '',
    '## 来週の実験', ...(out.next_week_experiments || []).map((e) => `- ${e.hypothesis} ／ 変えること：${e.change} ／ 成功の目安：${e.success_metric}`), '',
  ].join('\n');
  const reportFile = path.join(config.paths.data, 'reports', `analysis-${today}.md`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, report);

  applied.log.forEach((l) => log(l));
  log(`勝ちパターンを更新しました（data/patterns.json）。レポート：${path.relative(config.paths.root, reportFile)}`);
  log(`費用：${fmtUsd(cost.summary().total_usd)}`);
  return { records, stats, out, applied: applied.log, reportFile, cost: cost.summary() };
}
