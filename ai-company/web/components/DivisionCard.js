import Link from 'next/link';
import { LAMP_LABEL, fmtElapsed, fmtTime } from '@/lib/format';

export function Lamp({ lamp }) {
  return <span className={`lamp ${lamp}`} role="img" aria-label={LAMP_LABEL[lamp]} title={LAMP_LABEL[lamp]} />;
}

export default function DivisionCard({ d, now }) {
  return (
    <Link href={`/divisions/${d.slug}`} className={`card div-card ${d.lamp}`}>
      <div className="div-card-head">
        <h2><Lamp lamp={d.lamp} />{d.name}</h2>
        <span className="pill">{LAMP_LABEL[d.lamp]}{d.status === 'paused' && '・一時停止'}</span>
      </div>
      {d.running.map((t) => (
        <div className="running-box" key={t.id}>▶ {t.title}<span className="sub num"> ・ 経過 {fmtElapsed(t.started_at, now)}</span></div>
      ))}
      {d.lamp === 'failed' && d.last_task && (
        <div className="fail-box">✕ {d.last_task.title}: {d.last_task.error || '失敗'}</div>
      )}
      <div className="stats">
        <div className="stat"><b className="num">{d.done_today}</b><span>今日の完了</span></div>
        <div className="stat"><b className="num">{d.pending}</b><span>承認待ち</span></div>
        <div className="stat"><b className="num">{d.queued}</b><span>待機タスク</span></div>
      </div>
      {d.last_event && <div className="last-event">{fmtTime(d.last_event.created_at)} {d.last_event.message}</div>}
    </Link>
  );
}
