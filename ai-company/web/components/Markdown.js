// 最小限の Markdown 表示（見出し・箇条書き・段落・区切り線）。HTMLは解釈しない。
export default function Markdown({ text }) {
  if (!text) return <p className="sub">（内容がありません）</p>;
  const blocks = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { blocks.push(<p key={blocks.length}>{para.join('\n')}</p>); para = []; } };
  const flushList = () => { if (list) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (h) { flushPara(); flushList(); const T = `h${h[1].length}`; blocks.push(<T key={blocks.length}>{h[2]}</T>); }
    else if (li) { flushPara(); (list ||= []).push(li[1]); }
    else if (/^---+$/.test(line)) { flushPara(); flushList(); blocks.push(<hr key={blocks.length} />); }
    else if (line === '') { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{blocks}</div>;
}
