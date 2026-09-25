import path from 'node:path';
import { defineConfig } from 'vite';
import { loadEnvFile, ROOT } from './src/pipeline/config.js';
import { editorialApi } from './src/pipeline/dashboardApi.js';

loadEnvFile();

// 「投稿待ち」ページは output/ の完成品を読むため、開発サーバーにAPIを組み込む
export default defineConfig({
  plugins: [editorialApi({ outputDir: process.env.EDITORIAL_OUTPUT_DIR || path.join(ROOT, 'output'), allowRemote: process.env.DASHBOARD_ALLOW_REMOTE === '1' })],
});
