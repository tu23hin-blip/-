'use client';
// 日別の折れ線。値が null の日は線を切る（0 として描かない）。
import { useEffect, useRef, useState } from 'react';
import { isNum, fmtDate } from '@/lib/format';

function niceStep(range) {
  const raw = Math.max(range, 1) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw);
}

export default function LineChart({ data, series, height = 220, format = (v) => v, tooltipFormat = format }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 56, r: 12, t: 10, b: 26 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const values = data.flatMap((d) => series.map((s) => d[s.key])).filter(isNum);
  const hasData = values.length > 0;
  const lo = Math.min(0, ...values), hi = Math.max(1, ...values);
  const step = niceStep(hi - lo);
  const minV = Math.floor(lo / step) * step;
  const maxV = Math.max(minV + step, Math.ceil(hi / step) * step);
  const x = (i) => pad.l + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v) => pad.t + h - ((v - minV) / (maxV - minV)) * h;
  const ticks = [];
  for (let t = minV; t <= maxV + step / 2; t += step) ticks.push(t);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(w / 70)));

  // null で区切った線分
  const segments = (key) => {
    const segs = []; let cur = [];
    data.forEach((d, i) => {
      if (isNum(d[key])) cur.push([x(i), y(d[key])]);
      else if (cur.length) { segs.push(cur); cur = []; }
    });
    if (cur.length) segs.push(cur);
    return segs;
  };

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.l) / w) * (data.length - 1));
    setHover(i >= 0 && i < data.length ? i : null);
  };

  const hd = hover != null ? data[hover] : null;
  return (
    <div className="chart-wrap" ref={ref}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join('と') + 'の日別推移'}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={(e) => onMove(e.touches[0] ? { clientX: e.touches[0].clientX, currentTarget: e.currentTarget } : e)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1) && (
          <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtDate(d.date)}</text>
        ))}
        {series.map((s) => segments(s.key).map((seg, k) => seg.length === 1 ? (
          <circle key={`${s.key}${k}`} cx={seg[0][0]} cy={seg[0][1]} r="3" fill={s.color} />
        ) : (
          <polyline key={`${s.key}${k}`} points={seg.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )))}
        {hd && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--axis)" strokeWidth="1" />
            {series.map((s) => isNum(hd[s.key]) && (
              <circle key={s.key} cx={x(hover)} cy={y(hd[s.key])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
            ))}
          </g>
        )}
        {!hasData && <text x={pad.l + w / 2} y={pad.t + h / 2} textAnchor="middle" fill="var(--muted)" fontSize="13">この期間の数字はまだありません</text>}
      </svg>
      {hd && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover) - 70, 0), width - 160), top: 0 }}>
          <div className="t-date">{hd.date}</div>
          {series.map((s) => (
            <div key={s.key} className="num"><i style={{ background: s.color }} />{s.label}: {isNum(hd[s.key]) ? tooltipFormat(hd[s.key]) : '空欄（記録なし）'}</div>
          ))}
        </div>
      )}
    </div>
  );
}
