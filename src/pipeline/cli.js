#!/usr/bin/env node
// AI編集部のコマンド。package.json の npm scripts から呼ぶ
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadEnvFile, getConfig } from './config.js';
import { ConfigError, CostLimitError, LLMOutputError, RefusalError } from './errors.js';

const HELP = `AI編集部

  npm run produce -- --genre <ジャンルID>   ジャンルを指定して1本まるごと制作
  npm run produce -- --auto                 編集長がジャンルとネタを選んで制作
  npm run scout                             ジャンル探索（-- --count 5 で候補数を指定）
  npm run analyze                           週次分析（勝ちパターンとジャンルの継続/撤退）
  npm run demo                              APIを使わずにお試し制作（デモ用の架空データ）
  npm run render:samples                    図解テンプレートの見本を output/_samples に書き出す
  npm run prompts                           docs/ai-editorial-prompts.md を prompts/ に反映

オプション
  --force              note化の基準に届かなくても作る／撤退済みジャンルでも作る
  --start YYYY-MM-DD   X投稿の予定を始める日（省略時は明日）
  --mock               APIを使わずにデモ用の応答で動かす`;

async function main() {
  loadEnvFile();
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      genre: { type: 'string' }, auto: { type: 'boolean' }, force: { type: 'boolean' }, start: { type: 'string' },
      count: { type: 'string' }, mock: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (!command || values.help || command === 'help') {
    console.log(HELP);
    return;
  }
  const config = getConfig(values.mock ? { ...process.env, LLM_PROVIDER: 'mock' } : process.env);

  switch (command) {
    case 'produce': {
      const { produce } = await import('./produce.js');
      const r = await produce({ config, genreId: values.genre, auto: values.auto, force: values.force, startDate: values.start });
      if (r.status === 'no_idea') process.exitCode = 3;
      break;
    }
    case 'scout': {
      const { scout } = await import('./scout.js');
      await scout({ config, count: Math.max(1, Math.min(10, Number(values.count) || 3)) });
      break;
    }
    case 'analyze': {
      const { analyze } = await import('./analyze.js');
      await analyze({ config });
      break;
    }
    case 'prompts': {
      const { syncPrompts } = await import('./prompts.js');
      const r = syncPrompts({ docPath: config.paths.promptDoc, promptsDir: config.paths.prompts });
      console.log(`${r.chapters.length}章を読み込み、${r.written.length}ファイルを更新しました`);
      r.written.forEach((f) => console.log(`  更新: ${path.relative(config.paths.root, f)}`));
      r.unknown.forEach((f) => console.log(`  ⚠ ドキュメントにないファイル: prompts/${f}`));
      break;
    }
    case 'samples': {
      const { renderSamples } = await import('./samples.js');
      await renderSamples({ config });
      break;
    }
    default:
      throw new ConfigError(`不明なコマンドです: ${command}\n\n${HELP}`);
  }
}

main().catch((e) => {
  if (e instanceof CostLimitError) {
    console.error(`\n⛔ ${e.message}`);
    process.exitCode = 2;
  } else if (e instanceof ConfigError || e instanceof LLMOutputError || e instanceof RefusalError) {
    console.error(`\n⛔ ${e.message}`);
    process.exitCode = 1;
  } else {
    console.error(`\n⛔ 予期しないエラーで停止しました：${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exitCode = 1;
  }
});
