'use client';
import { useEffect, useState } from 'react';
import { usePoll } from '@/lib/usePoll';
import OutputCard from '@/components/OutputCard';

export default function InboxPage() {
  const { data, error, reload, updatedAt } = usePoll('/api/inbox');
  const [filter, setFilter] = useState('all');
  const [slugParam, setSlugParam] = useState(null);
  // オフィスの席から来たとき（/inbox?division=x-note）はその部門に絞る
  useEffect(() => {
    try { setSlugParam(new URLSearchParams(window.location.search).get('division')); } catch {}
  }, []);
  useEffect(() => {
    if (!slugParam || !data) return;
    const hit = data.pending.find((o) => o.division_slug === slugParam);
    if (hit) setFilter(hit.division_name);
    setSlugParam(null);
  }, [slugParam, data]);
  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return <p className="sub">読み込み中…</p>;
  const divisions = [...new Set(data.pending.map((o) => o.division_name))];
  const unposted = data.approved.filter((o) => !o.published_url);
  const posted = data.approved.filter((o) => o.published_url);
  const pending = filter === 'all' ? data.pending : data.pending.filter((o) => o.division_name === filter);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>承認待ちの受け箱</h1>
          <div className="sub">全事業部の下書き。AIは投稿しません。承認したものは下の「承認済み」からコピーして手動で投稿してください。{updatedAt && ` ・ ${updatedAt.toLocaleTimeString('ja-JP')} 更新`}</div>
        </div>
        {divisions.length > 1 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="btn" aria-label="事業部で絞り込み">
            <option value="all">すべての事業部</option>
            {divisions.map((d) => <option key={d}>{d}</option>)}
          </select>
        )}
      </div>
      <section>
        <h2 style={{ marginBottom: 10 }}>承認待ち（{data.pending.length}）</h2>
        {pending.length === 0 ? <p className="empty card">承認待ちはありません</p>
          : pending.map((o) => <OutputCard key={o.id} output={o} mode="inbox" showDivision onChange={reload} />)}
      </section>
      <section className="section">
        <h2 style={{ marginBottom: 10 }}>承認済み・未投稿（{unposted.length}）</h2>
        {unposted.length === 0 ? <p className="empty card">手動投稿待ちはありません</p>
          : unposted.map((o) => <OutputCard key={o.id} output={o} mode="approved" showDivision onChange={reload} />)}
        {posted.length > 0 && (
          <details className="section" open>
            <summary style={{ cursor: 'pointer' }}>投稿済み（直近 {posted.length} 件・ここで投稿ごとの数字を入力）</summary>
            <div style={{ marginTop: 10 }}>{posted.map((o) => <OutputCard key={o.id} output={o} mode="approved" showDivision onChange={reload} />)}</div>
          </details>
        )}
      </section>
    </>
  );
}
