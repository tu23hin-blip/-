// ダッシュボード（npm start）用のAPI。output/ の完成品を一覧にし、投稿状況を保存する。
// Vite の開発サーバーに組み込む（vite.config.js）。書き込みは status.json だけで、同じ画面からの JSON のみ受け付ける
import fs from 'node:fs';
import path from 'node:path';
import { listOutputs, loadOutput, saveStatus } from './outputs.js';
import { zipFiles } from './zip.js';

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};
const json = (res, status, value) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

export function summarize(item) {
  const { slug, meta, status, xPosts, state } = item;
  const file = (rel) => `/api/outputs/${slug}/files/${rel}`;
  const has = (rel) => fs.existsSync(path.join(item.dir, rel));
  return {
    slug,
    state,
    created_at: meta.created_at,
    demo: Boolean(meta.demo),
    title: meta.title,
    genre: meta.genre,
    price_yen: meta.price_yen,
    hashtags: meta.hashtags,
    magazine: meta.magazine,
    paywall: meta.paywall,
    review: {
      final_status: meta.review.final_status,
      quality_score: meta.review.quality_score,
      rounds: meta.review.rounds,
      notes_for_human: meta.review.notes_for_human,
      reasons: meta.review.reasons,
      issues: meta.review.final_status === 'needs_review' ? meta.review.issues : [],
    },
    warnings: meta.warnings || [],
    cost: meta.cost ? { total_usd: meta.cost.total_usd, total_jpy: meta.cost.total_jpy } : null,
    eyecatch: has('eyecatch.png') ? file('eyecatch.png') : null,
    images: (meta.images || []).map((img) => ({ id: img.id, url: file(img.file), file: img.file, alt_text: img.alt_text, position: img.position, warnings: img.warnings || [] })),
    x: xPosts ? { note_publish_label: xPosts.note_publish_label, posts: xPosts.posts } : null,
    status: status || {},
    files: {
      html: file('note_body.html'),
      md: file('note_body.md'),
      checklist: file('publish_checklist.md'),
      x_md: has('x_posts.md') ? file('x_posts.md') : null,
      zip: `/api/outputs/${slug}/images.zip`,
    },
  };
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('送信データが大きすぎます'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 未公開の記事を同じネットワークの他の端末から見られないよう、標準ではこのPCからのアクセスだけに答える
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = (req) => LOOPBACK.has(req.socket?.remoteAddress);

// 他のサイトから勝手に書き込まれないよう、同じ画面（オリジン）からのJSONだけを受け付ける
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createApiHandler({ outputDir, allowRemote = false }) {
  const root = path.resolve(outputDir);
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/outputs')) return next();
    if (!allowRemote && !isLocal(req)) return json(res, 403, { error: 'このPC以外からは見られない設定です（.env の DASHBOARD_ALLOW_REMOTE=1 で許可できます）' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/outputs') {
        return json(res, 200, { items: listOutputs(root).map(summarize) });
      }
      const m = url.pathname.match(/^\/api\/outputs\/([^/]+)(\/.*)?$/);
      const item = m && loadOutput(root, decodeURIComponent(m[1]));
      if (!item) return json(res, 404, { error: '完成品が見つかりません' });
      const rest = m[2] || '';

      if (req.method === 'GET' && rest === '/images.zip') {
        const files = [...(item.meta.images || []).map((i) => i.file), 'eyecatch.png'].filter((f) => fs.existsSync(path.join(item.dir, f)));
        const zip = zipFiles(files.map((f) => ({ name: path.basename(f), data: fs.readFileSync(path.join(item.dir, f)) })));
        return send(res, 200, zip, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${item.slug}_images.zip"` });
      }

      if (req.method === 'GET' && rest.startsWith('/files/')) {
        const file = path.resolve(item.dir, decodeURIComponent(rest.slice('/files/'.length)));
        const type = MIME[path.extname(file)];
        if (!file.startsWith(item.dir + path.sep) || file.includes(`${path.sep}work${path.sep}`) || !type || !fs.existsSync(file)) return json(res, 404, { error: 'ファイルが見つかりません' });
        return send(res, 200, fs.readFileSync(file), { 'content-type': type, 'content-security-policy': "script-src 'none'", 'cache-control': 'no-store' });
      }

      if (req.method === 'POST' && rest === '/status') {
        if (!sameOrigin(req) || !String(req.headers['content-type'] || '').includes('application/json')) return json(res, 403, { error: 'この画面からのみ保存できます' });
        const updated = saveStatus(root, item.slug, JSON.parse((await readBody(req)) || '{}'));
        return json(res, 200, summarize(updated));
      }
      return json(res, 404, { error: '不明なリクエストです' });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  };
}

// vite.config.js で使うプラグイン
export function editorialApi({ outputDir, allowRemote = false }) {
  const handler = createApiHandler({ outputDir, allowRemote });
  return {
    name: 'editorial-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
