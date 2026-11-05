'use client';
import { usePoll, useNow } from '@/lib/usePoll';
import { fmtTime, EVENT_LABEL } from '@/lib/format';
import DivisionCard from '@/components/DivisionCard';

export default function DivisionsPage() {
  const { data, error, updatedAt } = usePoll('/api/divisions');
  const now = useNow();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>事業部ビュー</h1>
          <div className="sub">10秒ごとに自動更新{updatedAt && ` ・ ${updatedAt.toLocaleTimeString('ja-JP')} 更新`}</div>
        </div>
        <div className="sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span><span className="lamp running" /> 実行中</span><span><span className="lamp awaiting" /> 承認待ち</span>
          <span><span className="lamp failed" /> 失敗</span><span><span className="lamp idle" /> 待機</span>
        </div>
      </div>
      {error && <div className="error-box">更新に失敗しました: {error}</div>}
      {!data ? <p className="sub">読み込み中…</p> : (
        <>
          <div className="grid cards">{data.divisions.map((d) => <DivisionCard key={d.slug} d={d} now={now} />)}</div>
          {data.global_events.length > 0 && (
            <section className="section card">
              <h2>全社のお知らせ</h2>
              <ul className="timeline">
                {data.global_events.map((e) => (
                  <li key={e.id}><time>{fmtTime(e.created_at)}</time><span className={`ev ev-${e.type}`}>{EVENT_LABEL[e.type]}</span><span>{e.message}</span></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
