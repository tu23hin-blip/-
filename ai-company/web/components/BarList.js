// 横棒（1指標）。null は棒を描かず「—」
import { isNum } from '@/lib/format';

export default function BarList({ items, format }) {
  const max = Math.max(1, ...items.map((i) => (isNum(i.value) ? i.value : 0)));
  return (
    <div className="bars" role="list">
      {items.map((it) => (
        <div className="bar-row" key={it.label} role="listitem" title={`${it.label}: ${format(it.value)}`}>
          <span className="bar-name">{it.label}</span>
          <span className="bar-track">
            {isNum(it.value) && <span className="bar" style={{ width: `${(Math.max(0, it.value) / max) * 100}%` }} />}
            <span className="bar-val num">{format(it.value)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
