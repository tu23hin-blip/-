import { escapeHtml } from '../lib/text.ts';

/**
 * 記事LP / LP の HTML 生成。
 * 外部CSSに依存せず1ファイルで完結させる（配信先の環境差でレイアウトが崩れないため）。
 * モバイル比率が9割を超えるため、モバイルファーストで組む。
 */

export type LpBlock =
  | { type: 'lead'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string; author?: string }
  | { type: 'callout'; title: string; text: string }
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'comparison'; headers: string[]; rows: string[][] }
  | { type: 'faq'; items: { q: string; a: string }[] }
  | { type: 'cta'; label: string; url: string; note?: string };

export type LpDocument = {
  kind: 'article_lp' | 'lp';
  title: string;
  subtitle?: string;
  brandName: string;
  /** ステマ規制対応: 事業者の表示であることの明示 */
  prLabel: string;
  heroImage?: string;
  blocks: LpBlock[];
  ctaUrl: string;
  ctaLabel: string;
  /** 打消し表示・注意書き（薬機法/景表法の要請） */
  disclaimers: string[];
  legalLinks?: { label: string; url: string }[];
};

const THEME = `
:root{
  --bg:#ffffff; --fg:#1f2933; --muted:#6b7280; --accent:#e2504f; --accent-dark:#c23c3b;
  --soft:#fff5f5; --line:#e5e7eb; --radius:14px;
}
*{box-sizing:border-box}
body{margin:0;font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;
  color:var(--fg);background:var(--bg);line-height:1.85;font-size:16px;-webkit-text-size-adjust:100%}
.wrap{max-width:680px;margin:0 auto;padding:0 18px 120px}
.pr{background:#f3f4f6;color:#6b7280;font-size:11px;letter-spacing:.08em;padding:7px 18px;text-align:center;border-bottom:1px solid var(--line)}
header.hero{padding:26px 0 12px}
h1{font-size:26px;line-height:1.5;margin:0 0 12px;font-weight:800;letter-spacing:-.01em}
h1 .em{background:linear-gradient(transparent 62%,#ffe08a 62%)}
.sub{color:var(--muted);font-size:14px;margin:0 0 18px}
.byline{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--muted);
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:22px}
.lead{font-size:17px;font-weight:600;background:var(--soft);border-left:4px solid var(--accent);
  padding:16px 18px;border-radius:0 var(--radius) var(--radius) 0;margin:20px 0}
h2{font-size:20px;margin:38px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--accent);font-weight:800}
p{margin:14px 0}
ul.points{list-style:none;padding:0;margin:18px 0;background:#fafafa;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
ul.points li{padding:13px 16px 13px 44px;position:relative;border-bottom:1px solid var(--line);font-size:15px}
ul.points li:last-child{border-bottom:none}
ul.points li::before{content:"✓";position:absolute;left:16px;color:var(--accent);font-weight:800}
blockquote{margin:20px 0;padding:16px 18px;background:#f8fafc;border-radius:var(--radius);
  border:1px solid var(--line);font-size:15px}
blockquote .author{display:block;margin-top:8px;font-size:12px;color:var(--muted)}
.callout{border:2px dashed var(--accent);border-radius:var(--radius);padding:18px;margin:24px 0;background:var(--soft)}
.callout h3{margin:0 0 8px;font-size:16px;color:var(--accent-dark)}
figure{margin:22px 0}
figure img{width:100%;border-radius:var(--radius);display:block}
figcaption{font-size:12px;color:var(--muted);margin-top:8px;text-align:center}
table.cmp{width:100%;border-collapse:collapse;margin:22px 0;font-size:14px}
table.cmp th,table.cmp td{border:1px solid var(--line);padding:10px 12px;text-align:center}
table.cmp thead th{background:var(--soft);font-weight:700}
table.cmp tbody th{background:#fafafa;text-align:left;font-weight:600}
.faq{margin:24px 0}
.faq details{border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin-bottom:10px;background:#fff}
.faq summary{font-weight:700;cursor:pointer;font-size:15px}
.faq p{margin:10px 0 0;font-size:14px;color:#374151}
.cta{margin:34px 0;text-align:center}
.cta a{display:block;background:linear-gradient(180deg,var(--accent),var(--accent-dark));color:#fff;
  text-decoration:none;font-weight:800;font-size:18px;padding:18px;border-radius:999px;
  box-shadow:0 6px 20px rgba(226,80,79,.35)}
.cta .note{font-size:12px;color:var(--muted);margin-top:10px}
.sticky{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.96);
  border-top:1px solid var(--line);padding:10px 16px;backdrop-filter:blur(6px);z-index:20}
.sticky a{display:block;background:linear-gradient(180deg,var(--accent),var(--accent-dark));color:#fff;
  text-decoration:none;font-weight:800;text-align:center;padding:14px;border-radius:999px}
.disclaimer{margin:40px 0 0;padding:16px;background:#f9fafb;border:1px solid var(--line);
  border-radius:var(--radius);font-size:11.5px;color:var(--muted);line-height:1.9}
.disclaimer li{margin-bottom:4px}
footer{margin-top:28px;font-size:11px;color:var(--muted);text-align:center}
footer a{color:var(--muted)}
@media (max-width:480px){ h1{font-size:23px} h2{font-size:18px} }
`;

function renderBlock(block: LpBlock): string {
  switch (block.type) {
    case 'lead':
      return `<div class="lead">${escapeHtml(block.text)}</div>`;
    case 'heading':
      return `<h2>${escapeHtml(block.text)}</h2>`;
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'list':
      return `<ul class="points">${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'quote':
      return `<blockquote>${escapeHtml(block.text)}${block.author ? `<span class="author">— ${escapeHtml(block.author)}</span>` : ''}</blockquote>`;
    case 'callout':
      return `<div class="callout"><h3>${escapeHtml(block.title)}</h3><p>${escapeHtml(block.text)}</p></div>`;
    case 'image':
      return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" loading="lazy">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
    case 'comparison':
      return `<table class="cmp"><thead><tr>${block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${block.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
    case 'faq':
      return `<div class="faq">${block.items.map((i) => `<details><summary>${escapeHtml(i.q)}</summary><p>${escapeHtml(i.a)}</p></details>`).join('')}</div>`;
    case 'cta':
      return `<div class="cta"><a href="${escapeHtml(block.url)}" rel="nofollow noopener">${escapeHtml(block.label)}</a>${block.note ? `<div class="note">${escapeHtml(block.note)}</div>` : ''}</div>`;
    default:
      return '';
  }
}

export function renderLp(doc: LpDocument): string {
  const isArticle = doc.kind === 'article_lp';
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(doc.title)}</title>
<meta property="og:title" content="${escapeHtml(doc.title)}">
<meta property="og:type" content="article">
<style>${THEME}</style>
</head><body>
<div class="pr">${escapeHtml(doc.prLabel)}</div>
<div class="wrap">
  <header class="hero">
    <h1>${escapeHtml(doc.title)}</h1>
    ${doc.subtitle ? `<p class="sub">${escapeHtml(doc.subtitle)}</p>` : ''}
    ${isArticle ? `<div class="byline"><span>提供：${escapeHtml(doc.brandName)}</span><span>広告</span></div>` : ''}
    ${doc.heroImage ? `<figure><img src="${escapeHtml(doc.heroImage)}" alt="${escapeHtml(doc.title)}"></figure>` : ''}
  </header>
  ${doc.blocks.map(renderBlock).join('\n  ')}
  <div class="cta"><a href="${escapeHtml(doc.ctaUrl)}" rel="nofollow noopener">${escapeHtml(doc.ctaLabel)}</a></div>
  <div class="disclaimer">
    <ul>${doc.disclaimers.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
  </div>
  <footer>
    ${(doc.legalLinks ?? []).map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(' ｜ ')}
    <div>© ${new Date().getFullYear()} ${escapeHtml(doc.brandName)}</div>
  </footer>
</div>
<div class="sticky"><a href="${escapeHtml(doc.ctaUrl)}" rel="nofollow noopener">${escapeHtml(doc.ctaLabel)}</a></div>
</body></html>`;
}

/** 法務チェックに掛けるためのプレーンテキスト抽出 */
export function toPlainText(doc: LpDocument): string {
  const parts: string[] = [doc.title, doc.subtitle ?? ''];
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'lead': case 'heading': case 'paragraph': parts.push(block.text); break;
      case 'list': parts.push(block.items.join('\n')); break;
      case 'quote': parts.push(block.text); break;
      case 'callout': parts.push(`${block.title}\n${block.text}`); break;
      case 'image': parts.push(block.alt, block.caption ?? ''); break;
      case 'comparison': parts.push(block.rows.flat().join(' ')); break;
      case 'faq': parts.push(block.items.map((i) => `${i.q}\n${i.a}`).join('\n')); break;
      case 'cta': parts.push(block.label, block.note ?? ''); break;
    }
  }
  parts.push(doc.ctaLabel, ...doc.disclaimers);
  return parts.filter(Boolean).join('\n');
}

/** 法務の修正文を各ブロックに反映（テキスト系ブロックのみ差し替え） */
export function applyRevisionToDoc(doc: LpDocument, revised: string): LpDocument {
  const lines = revised.split('\n').map((l) => l.trim()).filter(Boolean);
  let cursor = 0;
  const next: LpBlock[] = doc.blocks.map((block) => {
    if (block.type === 'paragraph' || block.type === 'lead' || block.type === 'heading') {
      const line = lines[cursor + 2];
      cursor++;
      return line ? { ...block, text: line } : block;
    }
    return block;
  });
  return { ...doc, title: lines[0] ?? doc.title, blocks: next };
}

export const STANDARD_DISCLAIMERS = [
  '本ページは広告・プロモーションを含みます。',
  '掲載内容は個人の感想であり、効果を保証するものではありません。',
  '価格・キャンペーン内容は予告なく変更される場合があります。最新情報は公式サイトをご確認ください。',
];
