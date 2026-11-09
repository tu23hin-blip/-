'use client';
// オフィス: 部門ごとの席にスタッフが座り、状態に合わせて動く。右に社長チャット（events）と売上、下に部門カード。
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePoll, useNow, post } from '@/lib/usePoll';
import { fmtYen, fmtNum, fmtPct, fmtTime, fmtElapsed, isNum, DASH } from '@/lib/format';
import Staff, { StaffFace, styleFor } from '@/components/Staff';

const STATE_LABEL = { working: '作業中', idle: '待機中', awaiting: '承認待ち', away: '一時停止', failed: '失敗' };
const STATE_LAMP = { working: 'running', idle: 'idle', awaiting: 'awaiting', away: 'idle', failed: 'failed' };

function Seat({ s, now, onOpen }) {
  const clickable = s.pending > 0;
  const label = `${s.name}: ${STATE_LABEL[s.state]}。${s.activity}${clickable ? '（押すと承認待ちへ）' : ''}`;
  const inner = (
    <>
      <div className={`bubble bubble--${s.state}`} title={s.activity}>{s.activity}</div>
      <Staff slug={s.slug} state={s.state} title={`${s.name}のスタッフ（${STATE_LABEL[s.state]}）`} />
      <div className="seat-plate">
        <span className={`lamp ${STATE_LAMP[s.state]}`} aria-hidden="true" />
        <span className="seat-name">{s.name}</span>
        <span className="pill">{STATE_LABEL[s.state]}{s.state === 'working' && s.running_since ? ` ${fmtElapsed(s.running_since, now)}` : ''}</span>
        {s.pending > 0 && <span className="badge" aria-hidden="true">{s.pending}</span>}
      </div>
    </>
  );
  return clickable
    ? <button type="button" className={`seat seat--${s.state} seat--clickable`} onClick={() => onOpen(s.slug)} aria-label={label}>{inner}</button>
    : <div className={`seat seat--${s.state}`} aria-label={label} role="group">{inner}</div>;
}

export default function OfficePage() {
  const router = useRouter();
  const { data, error, reload, updatedAt } = usePoll('/api/office');
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const runToday = async () => {
    if (!window.confirm('今日の予定のジョブ（一時停止中・今日実行済みを除く）を今すぐ動かします。\n本物の claude や X API を使うので費用がかかります。よろしいですか？')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post('/api/office/run', {});
      setMsg(r.started.length ? `開始しました: ${r.started.join('、')}` : `動かすジョブはありません${r.skipped.length ? `（${r.skipped.map((s) => `${s.key}: ${s.reason}`).join(' / ')}）` : ''}`);
      setTimeout(reload, 1500);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  if (error && !data) return <div className="error-box">読み込みに失敗しました: {error}</div>;
  if (!data) return <p className="sub">読み込み中…</p>;
  const working = data.staff.filter((s) => s.state === 'working').length;
  const cards = data.staff.filter((s) => !s.internal);

  return (
    <div className="office-page">
      <div className="page-head">
        <div>
          <h1>オフィス</h1>
          <div className="sub">10秒ごとに自動更新{updatedAt && ` ・ ${updatedAt.toLocaleTimeString('ja-JP')} 更新`}{working ? ` ・ ${working}人が作業中` : ''}</div>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn primary" disabled={busy} onClick={runToday}>今日の分を回す</button>
        </div>
      </div>
      {msg && <div className="notice" role="status">{msg}</div>}
      {data.seeded && <div className="notice">ダミーデータを表示中です（数字はすべて架空）。</div>}

      <div className="office-grid">
        <section className="office-floor" aria-label="オフィスの見取り図">
          <div className="office-wall">
            <div className="office-window" aria-hidden="true"><span /><span /></div>
            <div className="post-board" aria-label={`今月の投稿数 ${fmtNum(data.month_posts)}本`}>
              <div className="post-board-label">今月の投稿数</div>
              <div className="post-board-value num">{isNum(data.month_posts) ? fmtNum(data.month_posts) : DASH}<small>本</small></div>
            </div>
            <div className="office-clock num" aria-hidden="true">{new Date(now).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div className="seats">
            {data.staff.map((s) => <Seat key={s.slug} s={s} now={now} onOpen={(slug) => router.push(`/inbox?division=${encodeURIComponent(slug)}`)} />)}
          </div>
        </section>

        <aside className="office-side">
          <section className="card office-chat" aria-label="社長チャット">
            <h2>社長チャット</h2>
            <ol className="chat">
              {data.events.length === 0 && <li className="empty">まだ何も起きていません</li>}
              {data.events.map((e) => (
                <li key={e.id} className={`chat-item chat-item--${e.type}`}>
                  <StaffFace slug={e.division_slug} />
                  <div className="chat-body">
                    <div className="chat-meta"><b>{e.division_name || '全社'}</b><time className="num">{fmtTime(e.created_at)}</time></div>
                    <div className="chat-text">{e.type === 'fail' ? '⚠ ' : ''}{e.message}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card office-sales" aria-label="売上">
            <h2>売上</h2>
            <div className="sales-sum">
              <div><div className="kpi-label">今月の累計</div><div className="kpi-value num">{fmtYen(data.sales.month_revenue)}</div></div>
              <div><div className="kpi-label">販売件数</div><div className="kpi-value num">{isNum(data.sales.month_sales_count) ? `${fmtNum(data.sales.month_sales_count)}件` : DASH}</div></div>
            </div>
            {data.sales.recent.length === 0 ? <p className="sub">売上の記録はまだありません</p> : (
              <table className="sales-table">
                <thead><tr><th>日付</th><th>部門</th><th className="r">金額</th></tr></thead>
                <tbody>
                  {data.sales.recent.map((r, i) => (
                    <tr key={`${r.date}-${r.division_slug}-${i}`}>
                      <td className="num">{r.date.slice(5).replace('-', '/')}</td>
                      <td><span className="dot" style={{ background: styleFor(r.division_slug).color }} />{r.division_name}</td>
                      <td className="r num">{fmtYen(r.amount)}{isNum(r.sales_count) ? <span className="sub"> ・{r.sales_count}件</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </div>

      <section className="office-cards" aria-label="部門ごとのカード">
        {cards.map((s) => (
          <div className="card office-card" key={s.slug}>
            <div className="office-card-head"><StaffFace slug={s.slug} size={24} /><b>{s.name}</b><span className="pill">{STATE_LABEL[s.state]}</span></div>
            <div className="sub">今週の目標: {s.goal_label || DASH}</div>
            <div className="office-card-rate">
              <span className="progress"><span style={{ width: `${Math.min(100, (s.goal_rate || 0) * 100)}%` }} /></span>
              <span className="num">{fmtPct(s.goal_rate)}</span>
            </div>
            <div className="sub">
              承認待ち {s.pending > 0 ? <Link href={`/inbox?division=${encodeURIComponent(s.slug)}`}>{s.pending}件</Link> : '0件'}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
