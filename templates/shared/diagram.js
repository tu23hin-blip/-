// 図解テンプレート共通の描画処理。各テンプレートは window.drawBody(items, body, tools) を定義する。
// 文字は必ず textContent で入れる（AIの出力をHTMLとして解釈しない）。
(function () {
  const WEIGHTS = ['400', '700', '900'];
  // フォントを読み込んでから文字の大きさを調整する（読み込み前に測ると代替フォントの幅で計算してしまう）
  const fontsReady = Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 32px "Noto Sans JP"`, 'あ漢A1'))).then(() => document.fonts.ready);

  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function svg(markup) {
    const wrap = document.createElement('span');
    wrap.className = 'icon';
    wrap.innerHTML = markup; // テンプレート内の固定のSVGだけを渡す
    return wrap;
  }

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    arrow: '<svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 24h30M28 13l11 11-11 11"/></svg>',
  };

  const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted'];
  function applyColors(colors) {
    for (const key of COLOR_KEYS) {
      if (colors && typeof colors[key] === 'string' && /^#[0-9a-f]{3,8}$/i.test(colors[key])) {
        document.documentElement.style.setProperty(`--${key}`, colors[key]);
      }
    }
  }

  // Noto Sans JP は字面の箱が行の高さより大きいので、縦方向は少し余裕を見る。1行表示（nowrap）の要素は横幅だけ見る
  function overflows(el) {
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize) || 16;
    if (el.scrollWidth > el.clientWidth + 1) return true;
    return style.whiteSpace !== 'nowrap' && el.scrollHeight > el.clientHeight + Math.max(2, size * 0.3);
  }

  // data-fit="最大px,最小px" の要素を、はみ出さなくなるまで小さくする
  function fitAll(root) {
    root.querySelectorAll('[data-fit]').forEach((el) => {
      const [max, min] = el.dataset.fit.split(',').map(Number);
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && overflows(el)) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    });
  }

  function findOverflow(root) {
    const found = [];
    root.querySelectorAll('[data-fit]').forEach((el) => {
      if (overflows(el)) found.push(el.textContent.slice(0, 40));
    });
    const body = document.getElementById('body');
    if (body && (body.scrollHeight > body.clientHeight + 2 || body.scrollWidth > body.clientWidth + 2)) found.push('（図の本体が枠からはみ出しています）');
    return found;
  }

  window.renderDiagram = async function renderDiagram(data) {
    await fontsReady;
    applyColors(data.colors);
    const title = document.querySelector('.title');
    title.textContent = data.title || '';
    title.dataset.fit = '52,34';
    const sub = document.querySelector('.subtitle');
    sub.textContent = data.subtitle || '';
    sub.hidden = !data.subtitle;
    sub.dataset.fit = '24,18';
    document.querySelector('.footer').textContent = data.footer || '';
    document.querySelector('.brand').textContent = data.brand || '';
    const body = document.getElementById('body');
    body.replaceChildren();
    window.drawBody(data.items, body, { h, svg, ICONS, data });
    fitAll(document);
    // 文字の大きさが決まった後の調整（ラベルの重なりを避けるなど）はテンプレート側で行う
    if (typeof window.afterFit === 'function') window.afterFit(body);
    await document.fonts.ready;
    window.__RENDERED__ = true;
    return findOverflow(document);
  };

  window.diagramTools = { h, svg, ICONS };
})();
