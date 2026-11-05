'use client';
import { use, useState } from 'react';

const OUTPUT_PAGE = 10;
import Link from 'next/link';
import { usePoll, useNow, post } from '@/lib/usePoll';
import { fmtTime, fmtElapsed, TASK_STATUS_LABEL, EVENT_LABEL, LAMP_LABEL } from '@/lib/format';
import { Lamp } from '@/components/DivisionCard';
import OutputCard from '@/components/OutputCard';

const GROUP_ORDER = ['running', 'queued', 'awaiting_approval', 'failed', 'done'];

export default function DivisionDetailPage({ params }) {
  const { slug } = use(params);
  const { data, error, reload } = usePoll(`/api/divisions/${slug}`);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(OUTPUT_PAGE);

  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return <p className="sub">読み込み中…</p>;
  const { division: d, overview: ov, tasks, events, outputs } = data;

  const toggle = async () => {
    setBusy(true);
    try { await post(`/api/divisions/${slug}`, { action: d.status === 'active' ? 'pause' : 'resume' }); await reload(); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub"><Link href="/divisions">← 事業部ビュー</Link></div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Lamp lamp={ov.lamp} />{d.name}</h1>
          <div className="sub">{LAMP_LABEL[ov.lamp]} ・ Skill: {d.skill_name || '—'} ・ 今週の目標: {d.goal_label || '—'}</div>
        </div>
        <button className="btn" disabled={busy} onClick={toggle}>{d.status === 'active' ? '一時停止する' : '再開する'}</button>
      </div>
      {d.status === 'paused' && <div className="notice">この事業部は一時停止中です。定時実行では動きません。</div>}

      <div className="grid two">
        <section className="card">
          <h2>タスク</h2>
          {GROUP_ORDER.map((g) => tasks[g]?.length > 0 && (
            <div className="task-group" key={g}>
              <h3>{TASK_STATUS_LABEL[g]}（{tasks[g].length}）</h3>
              {tasks[g].slice(0, g === 'done' ? 10 : 30).map((t) => (
                <div className="task-row" key={t.id}>
                  <div>
                    <div>#{t.id} {t.title}</div>
                    {t.error && <div className="err">{t.error}</div>}
                  </div>
                  <div className="sub num" style={{ whiteSpace: 'nowrap' }}>
                    {g === 'running' ? `経過 ${fmtElapsed(t.started_at, now)}` : fmtTime(t.finished_at || t.started_at || t.created_at)}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {GROUP_ORDER.every((g) => !tasks[g]?.length) && <p className="empty">タスクはまだありません</p>}
        </section>

        <section className="card">
          <h2>タイムライン（新しい順）</h2>
          {events.length === 0 ? <p className="empty">記録はまだありません</p> : (
            <ul className="timeline scroll-box">
              {events.map((e) => (
                <li key={e.id}>
                  <time className="num">{fmtTime(e.created_at)}</time>
                  <span className={`ev ev-${e.type}`}>{EVENT_LABEL[e.type]}</span>
                  <span>{e.task_id && <span className="sub">#{e.task_id} </span>}{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section">
        <h2 style={{ marginBottom: 10 }}>成果物</h2>
        {outputs.length === 0 ? <p className="empty card">成果物はまだありません</p>
          : outputs.slice(0, shown).map((o) => <OutputCard key={o.id} output={o} mode="view" />)}
        {outputs.length > shown && <div className="actions"><button className="btn" onClick={() => setShown(shown + OUTPUT_PAGE)}>もっと見る（残り {outputs.length - shown} 件）</button></div>}
      </section>
    </>
  );
}
