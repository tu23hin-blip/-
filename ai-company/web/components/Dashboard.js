'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePoll } from '@/lib/usePoll';
import { fmtYen, fmtNum, fmtPct, fmtMinutes, isNum, DASH } from '@/lib/format';
import LineChart from './LineChart';
import BarList from './BarList';

const PERIODS = [7, 30, 90];

function Kpi({ label, value, note, tone }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value num ${tone || ''}`}>{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  useEffect(() => {
    try { const v = Number(localStorage.getItem('dash-days')); if (PERIODS.includes(v)) setDays(v); } catch {}
  }, []);
  const choose = (d) => { setDays(d); try { localStorage.setItem('dash-days', String(d)); } catch {} };
  const { data, error, updatedAt } = usePoll(`/api/dashboard?days=${days}`);

  if (error && !data) return <div className="error-box">読み込みに失敗しました: {error}</div>;
  if (!data) return <p className="sub">読み込み中…</p>;
  const p = data.period;
  const m = data.month;
  const periodNote = `直近${days}日`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>経営ダッシュボード</h1>
          <div className="sub">{data.from} 〜 {data.today}{updatedAt && ` ・ ${updatedAt.toLocaleTimeString('ja-JP')} 更新`}</div>
        </div>
        <div className="seg" role="group" aria-label="期間">
          {PERIODS.map((d) => <button key={d} className={d === days ? 'on' : ''} onClick={() => choose(d)} aria-pressed={d === days}>{d}日</button>)}
        </div>
      </div>

      {data.seeded && <div className="notice">ダミーデータを表示中です（数字はすべて架空）。本番運用の前に <code>npm run db:reset -- --yes</code> で消してください。</div>}

      <div className="grid kpis">
        <Kpi label="今月の売上" value={fmtYen(m.revenue)} note={`${m.start.slice(5).replace('-', '/')}〜今日`} />
        <Kpi label="前月比（同じ日数）" value={fmtPct(m.mom, true)} tone={isNum(m.mom) ? (m.mom >= 0 ? 'delta-up' : 'delta-down') : ''}
          note={isNum(m.prev_revenue) ? `前月同期間 ${fmtYen(m.prev_revenue)}` : '前月の売上データなし'} />
        <Kpi label="利益（売上 − APIコスト）" value={fmtYen(p.profit)} note={periodNote} tone={isNum(p.profit) && p.profit < 0 ? 'delta-down' : ''} />
        <Kpi label="APIコスト" value={fmtYen(p.api_cost_jpy)} note={periodNote} />
        <Kpi label="インプレッション" value={fmtNum(p.impressions)} note={periodNote} />
        <Kpi label="クリック" value={fmtNum(p.clicks)} note={periodNote} />
        <Kpi label="投稿数" value={fmtNum(p.posts)} note={periodNote} />
        <Kpi label="作業時間" value={fmtMinutes(p.work_minutes)} note={periodNote} />
      </div>

      <section className="section card">
        <h2>売上と利益の日別推移</h2>
        <div className="sub" style={{ marginBottom: 8 }}>記録がない日は線を切って空欄にしています（0円ではありません）</div>
        <LineChart data={data.daily} tooltipFormat={fmtYen} format={(v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString('ja-JP'))}
          series={[{ key: 'revenue', label: '売上', color: 'var(--series-1)' }, { key: 'profit', label: '利益', color: 'var(--series-2)' }]} />
      </section>

      <div className="grid two section">
        <section className="card">
          <h2>事業部別の売上</h2>
          <div className="sub" style={{ marginBottom: 10 }}>{periodNote}</div>
          <BarList items={data.by_division.map((d) => ({ label: d.name, value: d.revenue }))} format={fmtYen} />
        </section>
        <section className="card">
          <h2>事業部別のインプレッション</h2>
          <div className="sub" style={{ marginBottom: 10 }}>{periodNote}</div>
          <BarList items={data.by_division.map((d) => ({ label: d.name, value: d.impressions }))} format={fmtNum} />
        </section>
      </div>

      <section className="section card">
        <h2>事業部ごとの今週の目標</h2>
        <div className="sub" style={{ marginBottom: 6 }}>{data.week_start} 〜 {data.today}（月曜はじまり）</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>事業部</th><th>状態</th><th>今週の目標</th><th className="r">今週の実績</th><th>達成率</th></tr></thead>
            <tbody>
              {data.goals.map((g) => (
                <tr key={g.slug}>
                  <td><Link href={`/divisions/${g.slug}`}>{g.name}</Link></td>
                  <td><span className="pill">{g.status === 'active' ? '稼働中' : '一時停止'}</span></td>
                  <td>{g.goal_label || DASH}</td>
                  <td className="r num">{g.goal?.metric === 'revenue_jpy' ? fmtYen(g.actual) : fmtNum(g.actual)}</td>
                  <td className="num">
                    {isNum(g.rate) ? <><span className="progress"><span style={{ width: `${Math.min(100, g.rate * 100)}%` }} /></span>{fmtPct(g.rate)}</> : DASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section card">
        <h2>週次レポート</h2>
        {data.latest_report
          ? <p style={{ margin: '8px 0 0' }}>最新: <Link href={`/reports/${data.latest_report.id}`}>{data.latest_report.title || '週次レポート'}</Link></p>
          : <p className="sub">まだありません（分析担当が毎週月曜に作成します）</p>}
      </section>
    </>
  );
}
