// トレンド・ニュースの要約材料を集める（LLMは使わない）。
// data/trends.md の手書きメモ ＋ .env の TREND_FEEDS に書いたRSSの見出し。取れなかったものは飛ばす。

export function parseRssTitles(xml, limit = 10) {
  const items = [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, limit);
  const clean = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  return items
    .map((m) => ({ title: clean(m[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''), date: clean(m[0].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '') }))
    .filter((i) => i.title);
}

export async function collectTrends({ config, store, log = () => {}, fetchImpl = globalThis.fetch }) {
  const parts = [];
  const memo = store.readText('trends.md').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (memo) parts.push(`## 運営者のメモ\n${memo}`);
  for (const url of config.trendFeeds) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const titles = parseRssTitles(await res.text());
      if (titles.length) parts.push(`## ${new URL(url).hostname}\n${titles.map((t) => `- ${t.title}${t.date ? `（${t.date}）` : ''}`).join('\n')}`);
    } catch (e) {
      log(`   ⚠ トレンドを取得できませんでした: ${url}（${e.message}）`);
    }
  }
  return parts.join('\n\n') || 'なし（data/trends.md と TREND_FEEDS が未設定）';
}
