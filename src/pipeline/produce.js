// npm run produce … ネタ選び → リサーチ → 構成 → 本文 → 図解 → アイキャッチ → 校閲 → X投稿 までを1回で実行する
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ConfigError, CostLimitError } from './errors.js';
import { CostTracker, fmtUsd, usdToJpy } from './cost.js';
import { estimateProduce } from './estimate.js';
import { LLM } from './llm.js';
import { ROLES } from './roles.js';
import { Store, writeJsonAtomic } from './store.js';
import { collectTrends } from './trends.js';
import { recentOutputs, occupiedSlots } from './outputs.js';
import { todayIn } from './time.js';
import { chooseIdea } from './steps/ideas.js';
import { research, makeOutline, writeAndReview, diagramSpecs } from './steps/article.js';
import { renderDiagrams, makeEyecatch, softly } from './steps/visuals.js';
import { convertToPosts, planPosts } from './steps/xposts.js';
import { writePackage } from './package.js';
import { Renderer } from './render/renderer.js';

export const DEFAULT_COLORS = { primary: '#6657df', secondary: '#2b2548', accent: '#f5a76a' };

export function makeSlug(date, genreId, topic, now = new Date()) {
  const hash = crypto.createHash('sha1').update(`${topic}|${now.toISOString()}|${Math.random()}`).digest('hex').slice(0, 6);
  const id = String(genreId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'genre';
  return `${date}_${id}-${hash}`;
}

export function createCost(config, log) {
  // mock（お試し）はAPIを呼ばないので、検索の料金も0円で数える
  const webSearchPricePer1k = config.provider === 'mock' ? 0 : config.webSearch.pricePer1k;
  return new CostTracker({ limitUsd: config.costLimitUsd, usdJpy: config.usdJpy, priceOverride: config.price, webSearchPricePer1k, log });
}

export async function produce({ config, genreId, auto = false, force = false, startDate, log: print = console.log, now = new Date() }) {
  if (!genreId && !auto) throw new ConfigError('--genre <ジャンルID> か --auto を指定してください');
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ConfigError('--start は YYYY-MM-DD の形で指定してください');
  const lines = [];
  const log = (s) => {
    lines.push(s);
    print(s);
  };

  const store = new Store(config.paths.data);
  let genre = null;
  if (genreId) {
    genre = store.genres().find((g) => g.genre_id === genreId);
    if (!genre) throw new ConfigError(`ジャンル「${genreId}」が data/genres.json にありません（登録済み: ${store.genres().map((g) => g.genre_id).join(', ') || 'なし'}）`);
    if (genre.status === 'retired' && !force) throw new ConfigError(`ジャンル「${genreId}」は撤退済み（retired）です。それでも作る場合は --force を付けてください`);
    if (genre.needs_separate_account) log(`⚠ ジャンル「${genre.name}」は別アカウント向けです。今のXアカウントでは投稿しないでください`);
  }

  const cost = createCost(config, log);
  const estimate = estimateProduce(config, cost);
  log(`AI編集部：制作を開始します（${config.provider} / ${config.model}）`);
  log(`費用の概算：通常 ${fmtUsd(estimate.base)}（約${usdToJpy(estimate.base, config.usdJpy)}円）／書き直し2回なら最大 ${fmtUsd(estimate.worst)}／上限 ${fmtUsd(config.costLimitUsd)}`);
  if (config.costLimitUsd > 0 && estimate.base > config.costLimitUsd) {
    throw new CostLimitError(`費用の概算（${fmtUsd(estimate.base)}）が上限 COST_LIMIT_PER_RUN（${fmtUsd(config.costLimitUsd)}）を超えるため、開始前に停止しました。上限を上げるか、.env の LLM_MODEL を安いモデルにしてください`, { spentUsd: 0, estimateUsd: estimate.base, limitUsd: config.costLimitUsd });
  }

  // 画像を書き出せるか（ブラウザが起動するか）を、費用がかかる前に確かめる
  const renderer = await Renderer.launch({ templatesDir: config.paths.templates, chromiumPath: config.chromiumPath });
  const ctx = { config, cost, store, log, renderer, warnings: [], save: () => {} };
  let workDir = null;
  try {
    ctx.llm = await LLM.create(config, { cost, log });
    ctx.patterns = store.patterns();
    ctx.recent = recentOutputs(config.paths.output, 30, now);
    ctx.trends = await collectTrends({ config, store, log });

    log('━━ 1/6 ネタ選び（編集長）');
    const { pick, ideas } = await chooseIdea(ctx, { genre, force });
    if (!pick) {
      log('今日は note 化の基準（70点以上）を満たすネタがありませんでした。「Xでテスト」のネタは data/x_tests.json に保存しました。');
      log('基準未満でも作る場合は --force を付けてください。');
      return { status: 'no_idea', ideas, cost: cost.summary() };
    }
    genre ||= store.genres().find((g) => g.genre_id === pick.genre_id);
    Object.assign(ctx, { genre, colors: { ...DEFAULT_COLORS, ...(genre.colors || {}) }, brand: genre.brand || 'AI編集部' });
    log(`→ 「${pick.topic}」（${pick.score_total}点・${pick.verdict}）を ${genre.name} で作ります`);

    const createdAt = now.toISOString();
    const slug = makeSlug(todayIn(config.timezone, now), genre.genre_id, pick.topic, now);
    ctx.outDir = path.join(config.paths.output, slug);
    workDir = path.join(ctx.outDir, 'work');
    fs.mkdirSync(workDir, { recursive: true });
    ctx.save = (name, value) => writeJsonAtomic(path.join(workDir, name), value);
    ctx.save('01-ideas.json', { pick, ideas });

    log('━━ 2/6 リサーチ・構成');
    const researchJson = await research(ctx, pick);
    ctx.save('02-research.json', researchJson);
    const outline = await makeOutline(ctx, pick, researchJson);
    ctx.save('03-outline.json', outline);

    log('━━ 3/6 執筆・図解・校閲');
    const result = await writeAndReview(ctx, { idea: pick, researchJson, outline });

    log('━━ 4/6 画像の書き出し');
    const images = await renderDiagrams(ctx, { diagrams: result.diagrams.diagrams, missing: result.diagrams.missing, specs: diagramSpecs(outline), body: result.article.body_markdown });
    const eyecatch = await softly(ctx, 'アイキャッチ', () => makeEyecatch(ctx, { title: result.article.title, lead: outline.lead }));

    log('━━ 5/6 X投稿');
    const recentPosts = ctx.recent.flatMap((r) => (r.xPosts?.posts || []).map((p) => p.text));
    const converted = await softly(ctx, 'X投稿の作成', () => convertToPosts(ctx, { title: result.article.title, body: result.article.body_markdown, outline, recentPosts }));
    let x = null;
    if (converted) {
      converted.problems.forEach((p) => ctx.warnings.push(`X投稿：${p}`));
      x = await softly(ctx, 'X投稿の日時決め', () => planPosts(ctx, { posts: converted.posts, startDate, occupied: occupiedSlots(config.paths.output) }));
      if (x) ctx.save('06-x.json', x);
    }

    log('━━ 6/6 完成品の書き出し');
    const meta = writePackage(ctx.outDir, {
      slug, createdAt, demo: config.provider === 'mock', genre, idea: pick, outline,
      title: result.article.title, body: result.article.body_markdown, price: outline.price_yen,
      images, eyecatch, review: result, x, warnings: ctx.warnings, cost: cost.summary(),
      models: { provider: config.provider, default: config.model, roles: Object.fromEntries(Object.keys(ROLES).map((r) => [r, config.modelFor(r)])) },
    });

    const s = cost.summary();
    log('');
    log(`${result.finalStatus === 'ready' ? '✅ 完成（投稿待ち）' : '⚠ 完成（要確認：校閲で合格しませんでした）'}：${path.relative(config.paths.root, ctx.outDir) || ctx.outDir}`);
    log(`   タイトル：${meta.title}`);
    log(`   費用：${fmtUsd(s.total_usd)}（約${s.total_jpy}円）`);
    if (ctx.warnings.length) log(`   注意事項 ${ctx.warnings.length}件は publish_checklist.md を見てください`);
    return { status: result.finalStatus, outDir: ctx.outDir, slug, meta, cost: s };
  } catch (e) {
    if (workDir) {
      ctx.save('error.json', { name: e.name, message: e.message, at: new Date().toISOString(), cost: cost.summary() });
      log(`途中までの結果は ${path.relative(config.paths.root, workDir) || workDir} に保存しました`);
    }
    throw e;
  } finally {
    await renderer.close();
    if (workDir) fs.writeFileSync(path.join(workDir, 'run_log.txt'), `${lines.join('\n')}\n`);
  }
}
