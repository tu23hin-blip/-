import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  // ../engine のコード（DB・記録ライブラリ）をそのまま使う
  experimental: { externalDir: true },
  outputFileTracingRoot: path.join(here, '..'),
  devIndicators: false,
};
