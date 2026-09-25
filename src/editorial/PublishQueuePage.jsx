import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy, Download, FileText, CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, Send, Image as ImageIcon, Undo2, Save, Info,
} from 'lucide-react';

const STATE = {
  ready: { label: '投稿待ち', tone: 'ok' },
  needs_review: { label: '要確認', tone: 'ng' },
  posted: { label: '投稿済み', tone: 'done' },
};
const TABS = [
  { key: 'todo', label: '未投稿', match: (i) => i.state !== 'posted' },
  { key: 'needs_review', label: '要確認', match: (i) => i.state === 'needs_review' },
  { key: 'posted', label: '投稿済み', match: (i) => i.state === 'posted' },
  { key: 'all', label: 'すべて', match: () => true },
];
const METRICS = [
  ['note_pv', 'note PV'], ['note_likes', 'スキ'], ['purchases', '購入数'],
  ['x_impressions', 'X 表示回数'], ['x_profile_clicks', 'プロフィールクリック'], ['x_link_clicks', 'リンククリック'],
];
const NOTE_URL = '[noteのURL]';
const yen = (n) => (n > 0 ? `¥${Number(n).toLocaleString('ja-JP')}` : '無料');
const when = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// noteに貼る本文は、noteが扱えるタグだけ残す（属性は href 以外すべて外す）
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'A']);
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);
function sanitize(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      if (child.nodeType !== Node.TEXT_NODE) child.remove();
      continue;
    }
    if (DROP.has(child.tagName)) {
      child.remove();
      continue;
    }
    sanitize(child);
    if (!ALLOWED.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const a of [...child.attributes]) {
      if (!(child.tagName === 'A' && a.name === 'href' && /^https?:\/\//i.test(a.value))) child.removeAttribute(a.name);
    }
  }
  return node;
}

async function copyRich(html, text) {
  try {
    if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return true;
    }
  } catch { /* 下の方法で試す */ }
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.style.cssText = 'position:fixed;left:-9999px;top:0';
  el.innerHTML = html;
  document.body.append(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges();
  el.remove();
  return ok;
}

async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 下の方法で試す */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function Badge({ state }) {
  const s = STATE[state];
  return <span className={`pqBadge ${s.tone}`}>{state === 'needs_review' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{s.label}</span>;
}

function PostRow({ post, noteUrl, notify }) {
  const text = noteUrl ? post.text.replaceAll(NOTE_URL, noteUrl) : post.text;
  const copy = async () => notify((await copyText(text)) ? `${post.label}（${post.id}）をコピーしました` : 'コピーできませんでした', !noteUrl && post.type === 'cta' ? '誘導投稿の [noteのURL] は、noteのURLを保存すると自動で置き換わります' : '');
  return <div className="pqPost">
    <div className="pqPostHead"><b>{post.recommended_label}</b><span className={`pqType ${post.category}`}>{post.label}</span><span className="muted">{post.x_length}/280</span><button className="pqBtn ghost" onClick={copy}><Copy size={13} />コピー</button></div>
    <p>{text}</p>
    {post.warnings?.map((w) => <div className="pqWarn" key={w}><AlertTriangle size={12} />{w}</div>)}
  </div>;
}

function RecordForm({ item, onSave }) {
  const [noteUrl, setNoteUrl] = useState(item.status.note_url || '');
  const [xUrls, setXUrls] = useState((item.status.x_urls || []).join('\n'));
  const [metrics, setMetrics] = useState(item.status.metrics || {});
  const payload = (extra = {}) => ({ note_url: noteUrl, x_urls: xUrls.split(/\s+/).filter(Boolean), metrics, ...extra });
  return <div className="pqForm">
    <label>noteのURL<input value={noteUrl} onChange={(e) => setNoteUrl(e.target.value)} placeholder="https://note.com/..." /></label>
    <label>XのポストのURL（1行に1つ）<textarea rows={3} value={xUrls} onChange={(e) => setXUrls(e.target.value)} placeholder="https://x.com/..." /></label>
    <details>
      <summary>数値を記録する（週次分析に使います・任意）</summary>
      <div className="pqMetrics">{METRICS.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" value={metrics[key] ?? ''} onChange={(e) => setMetrics({ ...metrics, [key]: e.target.value })} /></label>)}</div>
    </details>
    <div className="pqActions">
      {item.state === 'posted'
        ? <button className="pqBtn ghost" onClick={() => onSave(payload({ status: 'unposted' }))}><Undo2 size={14} />未投稿に戻す</button>
        : <button className="primary" onClick={() => onSave(payload({ status: 'posted' }))}><Send size={14} />投稿済みにする</button>}
      <button className="pqBtn ghost" onClick={() => onSave(payload())}><Save size={14} />保存</button>
    </div>
  </div>;
}

function OutputCard({ item, onSaved, notify }) {
  const review = item.review;
  const copyBody = async () => {
    const [html, md] = await Promise.all([fetch(item.files.html).then((r) => r.text()), fetch(item.files.md).then((r) => r.text())]);
    const article = new DOMParser().parseFromString(html, 'text/html').getElementById('note-body');
    const plain = md.replace(/^# .*\n+/, '').replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '');
    const ok = article && (await copyRich(sanitize(article).innerHTML, plain));
    notify(ok ? '本文をコピーしました。noteのエディタに貼り付けてください' : 'コピーできませんでした', ok ? '【図N】の行に画像を、【ここに有料ラインを引く】の行に有料ラインを入れてください' : '');
  };
  const save = async (payload) => {
    const res = await fetch(`/api/outputs/${item.slug}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) return notify(data.error || '保存できませんでした', '', true);
    onSaved(data);
    notify(payload.status === 'posted' ? '投稿済みにしました' : '保存しました');
  };

  return <article className={`card pqCard ${item.state}`}>
    <div className="pqMain">
      {item.eyecatch ? <a href={item.eyecatch} target="_blank" rel="noreferrer" className="pqEye"><img src={item.eyecatch} alt="アイキャッチ" /></a> : <div className="pqEye empty"><ImageIcon size={22} />アイキャッチなし</div>}
      <div className="pqInfo">
        <div className="pqTags"><Badge state={item.state} /><span className="pqTag">{item.genre.name}</span><span className="pqTag">{yen(item.price_yen)}</span>{item.demo && <span className="pqTag demo">デモ</span>}</div>
        <h3>{item.title}</h3>
        <p className="pqMeta">作成 {when(item.created_at)}　校閲スコア {review.quality_score ?? '−'}（{review.rounds}回目で判定）{item.cost && `　費用 $${item.cost.total_usd}（約${item.cost.total_jpy}円）`}</p>
        <div className="pqButtons">
          <button className="primary" onClick={copyBody}><Copy size={14} />本文をコピー（リッチテキスト）</button>
          <a className="pqBtn" href={item.files.zip} download><Download size={14} />画像を一括ダウンロード</a>
          <a className="pqBtn" href={item.files.checklist} target="_blank" rel="noreferrer"><FileText size={14} />投稿手順</a>
          <a className="pqBtn" href={item.files.html} target="_blank" rel="noreferrer"><ExternalLink size={14} />本文を開く</a>
        </div>
      </div>
    </div>

    {item.state === 'needs_review' && <div className="pqAlert">
      <b><AlertTriangle size={14} />要確認：校閲で合格しませんでした。公開する前に次の点を確認してください。</b>
      <ul>
        {review.notes_for_human && <li>{review.notes_for_human}</li>}
        {review.reasons?.map((r) => <li key={r}>{r}</li>)}
        {review.issues?.slice(0, 6).map((i, n) => <li key={n}>[{i.check}] {i.location ? `${i.location}：` : ''}{i.problem}</li>)}
      </ul>
    </div>}
    {item.state === 'ready' && review.notes_for_human && <div className="pqNote"><Info size={13} />{review.notes_for_human}</div>}
    {item.warnings.length > 0 && <div className="pqWarnBox">{item.warnings.map((w) => <div key={w}><AlertTriangle size={12} />{w}</div>)}</div>}

    {item.images.length > 0 && <div className="pqImages">{item.images.map((img) => <a key={img.id} href={img.url} target="_blank" rel="noreferrer" title={img.position ? `見出し「${img.position.heading}」の「${img.position.after}」の後` : ''}>
      <img src={img.url} alt={img.alt_text} /><span>{img.id}・{img.file}</span></a>)}
      {item.paywall && <div className="pqPaywall">有料ライン：見出し「{item.paywall.heading}」の「{item.paywall.after}」の後（無料部分 約{Math.round(item.paywall.free_ratio * 100)}%）</div>}
    </div>}

    <details className="pqSection">
      <summary>X投稿 {item.x ? `${item.x.posts.length}本（note公開の推奨：${item.x.note_publish_label}）` : '（未作成）'}</summary>
      {item.x ? item.x.posts.map((p) => <PostRow key={p.id} post={p} noteUrl={item.status.note_url} notify={notify} />) : <p className="muted">X投稿は作成されませんでした。投稿手順の「確認すること」を見てください。</p>}
    </details>
    <details className="pqSection">
      <summary>投稿を記録する{item.status.posted_at ? `（投稿済み ${when(item.status.posted_at)}）` : ''}</summary>
      <RecordForm item={item} onSave={save} />
    </details>
  </article>;
}

export default function PublishQueuePage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('todo');
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, sub = '', isError = false) => {
    setToast({ message, sub, isError });
    setTimeout(() => setToast(null), sub ? 4500 : 2500);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/outputs');
      if (!res.ok) throw new Error();
      setItems((await res.json()).items);
      setError('');
    } catch {
      setError('完成品の一覧を読み込めませんでした。ターミナルで npm start を実行して開いたダッシュボードから見てください。');
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, items.filter(t.match).length])), [items]);
  const shown = items.filter(TABS.find((t) => t.key === tab).match);
  const replace = (next) => setItems((list) => list.map((i) => (i.slug === next.slug ? next : i)));

  return <div className="pqPage">
    <div className="pqSummary">
      {['ready', 'needs_review', 'posted'].map((s) => <div key={s} className={`card pqCount ${STATE[s].tone}`}><span>{STATE[s].label}</span><b>{items.filter((i) => i.state === s).length}</b></div>)}
      <div className="card pqHow"><b>人間の作業はここだけ</b><span>内容を確認 → 本文をコピーしてnoteに貼る → 画像・有料ライン・価格を設定 → Xに予約投稿 → URLを記録</span></div>
    </div>
    <div className="pqToolbar">
      <div className="filter">{TABS.map((t) => <button key={t.key} className={tab === t.key ? 'selected' : ''} onClick={() => setTab(t.key)}>{t.label}（{counts[t.key] || 0}）</button>)}</div>
      <button className="pqBtn ghost" onClick={load}><RefreshCw size={13} />再読み込み</button>
    </div>
    {error && <div className="pqAlert"><b><AlertTriangle size={14} />{error}</b></div>}
    {!error && !loading && !shown.length && <div className="card pqEmpty">
      <Send size={26} />
      <h3>{items.length ? 'この一覧に該当する完成品はありません' : 'まだ完成品がありません'}</h3>
      <p>ターミナルで <code>npm run produce -- --genre ai-note-automation</code> を実行すると、ここに並びます（APIを使わないお試しは <code>npm run demo</code>）。</p>
    </div>}
    {shown.map((item) => <OutputCard key={item.slug} item={item} onSaved={replace} notify={notify} />)}
    {toast && <div className={`toast pqToast ${toast.isError ? 'err' : ''}`}>{toast.isError ? <AlertTriangle /> : <CheckCircle2 />}<div><b>{toast.message}</b>{toast.sub && <span>{toast.sub}</span>}</div></div>}
  </div>;
}
