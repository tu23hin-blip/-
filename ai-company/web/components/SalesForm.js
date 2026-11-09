'use client';
// 売上・販売件数の入力（事業部×日）。空欄の項目は変更しない。
import { useEffect, useState } from 'react';
import { post } from '@/lib/usePoll';
import { fmtYen, fmtNum } from '@/lib/format';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function SalesForm({ divisions, onSaved }) {
  const [division, setDivision] = useState(divisions[0]?.slug || '');
  const [date, setDate] = useState(todayStr);
  const [revenue, setRevenue] = useState('');
  const [count, setCount] = useState('');
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (!division && divisions[0]) setDivision(divisions[0].slug); }, [divisions, division]);
  useEffect(() => {
    if (!division || !date) return;
    let alive = true;
    fetch(`/api/sales?division=${encodeURIComponent(division)}&date=${date}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setCurrent(j); }).catch(() => {});
    return () => { alive = false; };
  }, [division, date]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const { saved } = await post('/api/sales', { division, date, revenue_jpy: revenue, sales_count: count });
      setCurrent(saved); setRevenue(''); setCount('');
      setMsg(`保存しました（${saved.date}: 売上 ${fmtYen(saved.revenue_jpy)} / ${fmtNum(saved.sales_count)}件）`);
      onSaved?.();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };

  if (!divisions.length) return <p className="sub">事業部がまだありません</p>;
  return (
    <form onSubmit={submit}>
      <div className="sales-form">
        <label className="field">事業部
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            {divisions.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
          </select>
        </label>
        <label className="field">日付
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">売上（円）
          <input inputMode="numeric" placeholder={current?.revenue_jpy != null ? String(current.revenue_jpy) : '例: 3000'} value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </label>
        <label className="field">販売件数
          <input inputMode="numeric" placeholder={current?.sales_count != null ? String(current.sales_count) : '例: 6'} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={busy || (!revenue.trim() && !count.trim())}>保存</button>
      </div>
      <div className="sub" style={{ marginTop: 6 }} role="status">
        {msg || (current ? `この日の記録: 売上 ${fmtYen(current.revenue_jpy)} / ${fmtNum(current.sales_count)}件（空欄の項目は変更しません。同じ日に入れ直すと上書き）` : '')}
      </div>
    </form>
  );
}
