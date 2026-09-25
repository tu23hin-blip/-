// 図解・アイキャッチをPNGに書き出す。テンプレートは専用のドメイン（editorial.local）から配信し、同梱フォントを確実に読み込ませる。
// それ以外の通信はすべて遮断する（AIが書いたHTMLが外部を読みに行かないようにするため）。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ConfigError } from '../errors.js';

const HOST = 'http://editorial.local';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
};
export const SIZES = { diagram: { width: 1280, height: 720 }, eyecatch: { width: 1280, height: 670 } };

// AIが書いたHTMLはスクリプト・外部読み込みを禁止し、同梱フォントだけを使えるようにする
const CUSTOM_CSP = `default-src 'none'; style-src 'unsafe-inline' ${HOST}; font-src ${HOST}; img-src data:; script-src 'none'`;

function withFonts(html) {
  const link = `<link rel="stylesheet" href="${HOST}/shared/fonts.css"><style>html,body{margin:0;overflow:hidden}body{font-family:"Noto Sans JP",sans-serif}</style>`;
  const clean = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
  return /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, (m) => `${m}${link}`) : `<!doctype html><html lang="ja"><head><meta charset="utf-8">${link}</head><body>${clean}</body></html>`;
}

export class Renderer {
  static async launch({ templatesDir, chromiumPath }) {
    let browser;
    try {
      browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
    } catch (e) {
      throw new ConfigError(`画像の書き出しに使うブラウザを起動できませんでした。「npx playwright install chromium」を実行するか、.env の CHROMIUM_PATH を設定してください。（${e.message.split('\n')[0]}）`);
    }
    return new Renderer(browser, templatesDir);
  }

  constructor(browser, templatesDir) {
    this.browser = browser;
    this.templatesDir = path.resolve(templatesDir);
  }

  async open({ width, height, pages = {} }) {
    const context = await this.browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      window.__NO_SAMPLE__ = true;
    });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== HOST) return route.abort();
      if (pages[url.pathname]) {
        return route.fulfill({ status: 200, contentType: MIME['.html'], headers: { 'content-security-policy': CUSTOM_CSP }, body: pages[url.pathname] });
      }
      const file = path.join(this.templatesDir, decodeURIComponent(url.pathname));
      if (!file.startsWith(this.templatesDir + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    const page = await context.newPage();
    return { page, close: () => context.close() };
  }

  // 同梱の Noto Sans JP が実際に使われたかを確かめる（使われていないと代替フォントで文字の形が崩れる）
  async assertFonts(page) {
    const state = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Noto Sans JP');
      return { loaded: faces.filter((f) => f.status === 'loaded').length, error: faces.filter((f) => f.status === 'error').length };
    });
    if (!state.loaded || state.error) throw new Error('同梱フォント（Noto Sans JP）を読み込めませんでした。templates/fonts を確認してください');
  }

  async renderDiagram(diagram, { colors, brand, outPath }) {
    const { page, close } = await this.open(SIZES.diagram);
    try {
      await page.goto(`${HOST}/diagrams/${diagram.type}.html`);
      const overflow = await page.evaluate((d) => window.renderDiagram(d), { ...diagram, colors, brand });
      await this.assertFonts(page);
      await page.screenshot({ path: outPath, type: 'png' });
      return { overflow };
    } finally {
      await close();
    }
  }

  async renderCustom(html, { outPath, size = SIZES.diagram }) {
    const { page, close } = await this.open({ ...size, pages: { '/custom.html': withFonts(html) } });
    try {
      await page.goto(`${HOST}/custom.html`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: outPath, type: 'png' });
      return { overflow: [] };
    } finally {
      await close();
    }
  }

  async renderEyecatch(spec, { colors, brand, iconSvg, background, outPath }) {
    const { page, close } = await this.open(SIZES.eyecatch);
    try {
      await page.goto(`${HOST}/eyecatch/eyecatch.html`);
      const overflow = await page.evaluate((d) => window.renderEyecatch(d), { ...spec, colors, brand, icon_svg: iconSvg, background });
      await this.assertFonts(page);
      await page.screenshot({ path: outPath, type: 'png' });
      return { overflow };
    } finally {
      await close();
    }
  }

  async close() {
    await this.browser.close();
  }
}
