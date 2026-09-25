// 本文Markdownの処理。[図N] マーカーと <<<PAYWALL>>> を扱い、noteのエディタに貼れるHTMLに変換する。
// noteのエディタが扱えるのは 見出し(大/小)・太字・リスト・引用・コード・区切り線・リンク なので、それ以外のタグは出さない。

const MARKER_RE = /^\s*[[［]\s*図\s*([0-9０-９]+)\s*[\]］]\s*$/;
const INLINE_MARKER_RE = /[[［]\s*図\s*[0-9０-９]+\s*[\]］]/;
export const PAYWALL_RE = /^\s*<<<\s*PAYWALL\s*>>>\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

const toHalfWidth = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// '[図1]' / '［図１］' → '図1'
export function markerId(line) {
  const m = String(line).match(MARKER_RE);
  return m ? `図${Number(toHalfWidth(m[1]))}` : null;
}

export const diagramNumber = (id) => Number(String(id).replace(/\D/g, '')) || 0;

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

// コードブロックの中を飛ばしながら1行ずつ見る
function* walk(markdown) {
  let inFence = false;
  for (const line of String(markdown).replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      yield { line, fence: true, inFence: true };
      continue;
    }
    yield { line, fence: false, inFence };
  }
}

export function markdownToHtml(markdown, { marker = (id) => `<p>［${id}］</p>`, paywall = () => '<hr>' } = {}) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  let quote = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`);
    quote = [];
  };
  const flush = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const id = markerId(line);
    if (id) { flush(); out.push(marker(id)); continue; }
    if (PAYWALL_RE.test(line)) { flush(); out.push(paywall()); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const tag = heading[1].length <= 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(heading[2])}</${tag}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      flushQuote();
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (list?.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(item[2]);
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    flushList();
    flushQuote();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 表はnoteで使えないので「｜」区切りの行にする（区切り行は捨てる）
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) para.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('｜'));
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

// 有料ラインの前後に分ける
export function splitAtPaywall(markdown) {
  const lines = String(markdown).split('\n');
  const idx = lines.findIndex((l) => PAYWALL_RE.test(l));
  if (idx === -1) return { free: markdown, paid: '', found: false };
  return { free: lines.slice(0, idx).join('\n'), paid: lines.slice(idx + 1).join('\n'), found: true };
}

// マーカー行を取り除いた本文（X投稿の材料など）
export const stripMarkers = (markdown) =>
  String(markdown).split('\n').filter((l) => !markerId(l) && !PAYWALL_RE.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();

const plain = (s) => s.replace(/\*\*|`/g, '').replace(/^\s*([-*+]|\d+[.)]|>)\s+/, '').trim();
export const snippet = (s, n = 24) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s);

// 各マーカーと有料ラインが、どの見出しのどの文の後ろにあるか（投稿手順の説明用）
export function locateMarkers(markdown) {
  const markers = {};
  let paywall = null;
  let heading = '（冒頭）';
  let last = '';
  for (const { line, fence, inFence } of walk(markdown)) {
    if (fence || inFence) {
      last = '（コードブロック）';
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.+)/);
    if (h) {
      heading = plain(h[1]);
      last = '';
      continue;
    }
    const id = markerId(line);
    if (id) markers[id] = { heading, after: snippet(last) };
    else if (PAYWALL_RE.test(line)) paywall = { heading, after: snippet(last) };
    else if (line.trim()) last = plain(line);
  }
  return { markers, paywall };
}

// 本文の形式チェック：[図N] が図解の指定と1対1か、<<<PAYWALL>>> が1回だけか
export function checkStructure(markdown, expectedIds = [], { requirePaywall = true } = {}) {
  const ids = [];
  const issues = [];
  let paywalls = 0;
  for (const { line, fence, inFence } of walk(markdown)) {
    if (fence || inFence) continue;
    const id = markerId(line);
    if (id) ids.push(id);
    else if (INLINE_MARKER_RE.test(line)) issues.push(`図のマーカーが文の途中にあります（単独の行にしてください）：「${snippet(line.trim(), 30)}」`);
    if (PAYWALL_RE.test(line)) paywalls += 1;
    else if (/<<<\s*PAYWALL\s*>>>/.test(line)) issues.push('<<<PAYWALL>>> が文の途中にあります（単独の行にしてください）');
  }
  if (requirePaywall ? paywalls !== 1 : paywalls > 1) issues.push(`<<<PAYWALL>>> が${paywalls}回あります（1回だけ入れてください）`);
  const seen = new Set();
  ids.forEach((id) => {
    if (seen.has(id)) issues.push(`[${id}] が2回以上あります`);
    seen.add(id);
  });
  expectedIds.filter((id) => !seen.has(id)).forEach((id) => issues.push(`構成で指定された [${id}] のマーカーがありません`));
  return { ids: [...seen], issues };
}
