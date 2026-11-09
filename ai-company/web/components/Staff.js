// オフィスのスタッフ（独自デザインのSVG）。丸い頭・丸い体の「マル」スタイル。
// 部門ごとに色と机の上の小物を変え、状態でポーズとアニメーションを変える。
//   working: タイピング ／ idle: 休憩（マグカップ） ／ awaiting: 手を挙げる ／ away: 席を外している ／ failed: 頭に「！」

export const DIVISION_STYLE = {
  'x-note': { color: '#2a78d6', prop: 'notebook' },
  'short-video': { color: '#eb6834', prop: 'clapper' },
  'site-llmo': { color: '#1baf7a', prop: 'globe' },
  analyst: { color: '#6250d6', prop: 'magnifier' },
  metrics: { color: '#c2477a', prop: 'calculator' },
  materials: { color: '#2f8a3a', prop: 'books' },
};
const FALLBACK = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#c2477a', '#2f8a3a'];
const PROPS = ['notebook', 'clapper', 'globe', 'magnifier', 'calculator', 'books'];

export function styleFor(slug) {
  if (DIVISION_STYLE[slug]) return DIVISION_STYLE[slug];
  const h = Array.from(slug || '').reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { color: FALLBACK[h % FALLBACK.length], prop: PROPS[h % PROPS.length] };
}

function Prop({ kind, color }) {
  switch (kind) {
    case 'notebook':
      return <g transform="translate(112 86)"><rect width="22" height="15" rx="2" fill="#fff" stroke={color} strokeWidth="1.5" /><path d="M4 5h14M4 9h10" stroke={color} strokeWidth="1.2" /><path d="M20 -6l6 -3 1 3 -6 3z" fill="#f2b84b" /></g>;
    case 'clapper':
      return <g transform="translate(112 84)"><rect y="5" width="22" height="13" rx="1.5" fill="#33312e" /><path d="M0 5l20 -6 2 5 -20 6z" fill="#fff" stroke="#33312e" strokeWidth="1" /><path d="M5 3l3 4M11 1l3 4" stroke="#33312e" strokeWidth="1.4" /></g>;
    case 'globe':
      return <g transform="translate(122 90)"><circle r="9" fill="#bfe8d6" stroke={color} strokeWidth="1.5" /><path d="M-9 0h18M0 -9c-4 4 -4 14 0 18M0 -9c4 4 4 14 0 18" stroke={color} strokeWidth="1" fill="none" /><rect x="-5" y="9" width="10" height="3" rx="1" fill={color} /></g>;
    case 'magnifier':
      return <g transform="translate(112 84)"><rect width="22" height="16" rx="2" fill="#fff" stroke="#c3c2b7" /><path d="M4 12l5 -5 4 3 6 -7" stroke={color} strokeWidth="1.5" fill="none" /><circle cx="20" cy="3" r="4.5" fill="none" stroke="#33312e" strokeWidth="1.6" /><path d="M23 6l4 4" stroke="#33312e" strokeWidth="2" /></g>;
    case 'calculator':
      return <g transform="translate(114 82)"><rect width="17" height="20" rx="2.5" fill="#55534e" /><rect x="3" y="3" width="11" height="5" rx="1" fill="#cfe8d0" />{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={3 + c * 4} y={10 + r * 3.2} width="2.6" height="2.2" rx=".6" fill="#e9e7df" />))}</g>;
    case 'books':
      return <g transform="translate(110 85)"><rect y="10" width="24" height="5" rx="1" fill={color} /><rect x="2" y="5" width="21" height="5" rx="1" fill="#f2b84b" /><rect x="1" width="22" height="5" rx="1" fill="#8fb8e8" /></g>;
    default:
      return <g transform="translate(118 86)"><rect x="-4" y="6" width="12" height="9" rx="2" fill="#b77c4e" /><path d="M2 6c-6 -8 0 -14 0 -14c0 0 6 6 0 14" fill="#4f9e5a" /></g>;
  }
}

/** 机と椅子と小物。character を渡すと座らせる */
export default function Staff({ slug, state, size = 150, title }) {
  const { color, prop } = styleFor(slug);
  const dark = `color-mix(in srgb, ${color} 70%, #000)`;
  const skin = '#f6dcc2';
  const present = state !== 'away';
  return (
    <svg className={`staff staff--${state}`} viewBox="0 0 160 150" width={size} height={size * 150 / 160} role="img" aria-label={title}>
      <ellipse cx="80" cy="140" rx="62" ry="7" fill="var(--office-shadow)" />
      {/* 椅子 */}
      <g className={present ? '' : 'chair-away'}>
        <rect x="54" y="48" width="52" height="56" rx="14" fill="var(--office-chair)" />
        <rect x="75" y="118" width="10" height="16" fill="var(--office-chair)" />
        <rect x="62" y="132" width="36" height="4" rx="2" fill="var(--office-chair)" />
      </g>
      {present && (
        <g className="body">
          {/* 胴体 */}
          <path d="M56 104c0 -26 8 -38 24 -38s24 12 24 38z" fill={color} />
          <path d="M72 72l8 8 8 -8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
          {/* 頭 */}
          <g className="head">
            <circle cx="80" cy="44" r="20" fill={skin} />
            <path d="M60 42c0 -14 9 -21 20 -21s20 7 20 21c-5 -6 -12 -9 -20 -9s-15 3 -20 9z" fill={dark} />
            <circle className="eye" cx="73" cy="47" r="2" fill="#33312e" />
            <circle className="eye" cx="87" cy="47" r="2" fill="#33312e" />
            {state === 'failed'
              ? <path d="M74 56q6 -4 12 0" fill="none" stroke="#33312e" strokeWidth="1.8" strokeLinecap="round" />
              : <path d="M74 54q6 5 12 0" fill="none" stroke="#33312e" strokeWidth="1.8" strokeLinecap="round" />}
            <circle cx="68" cy="52" r="2.6" fill="#f3a9a0" opacity=".6" />
            <circle cx="92" cy="52" r="2.6" fill="#f3a9a0" opacity=".6" />
          </g>
          {/* 腕 */}
          {state === 'awaiting' ? (
            <>
              <g className="arm-raise"><path d="M100 80c8 -8 10 -24 8 -40" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" /><circle cx="108" cy="36" r="6" fill={skin} /></g>
              <path d="M60 82c-6 6 -6 12 -2 16" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
            </>
          ) : state === 'idle' ? (
            <>
              <path d="M60 82c-6 6 -6 12 -2 16" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
              <g className="mug">
                <path d="M100 82c6 -2 8 -8 6 -14" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
                <rect x="100" y="58" width="12" height="13" rx="2" fill="#fff" stroke="#c3c2b7" />
                <path d="M112 61c4 0 4 7 0 7" fill="none" stroke="#c3c2b7" strokeWidth="1.5" />
                <path className="steam" d="M104 54c-2 -3 2 -5 0 -8M108 54c-2 -3 2 -5 0 -8" fill="none" stroke="#b9b7ae" strokeWidth="1.3" strokeLinecap="round" />
              </g>
            </>
          ) : (
            <>
              <g className="hand hand-l"><path d="M60 82c-6 6 -4 14 4 16" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" /><circle cx="66" cy="99" r="4.5" fill={skin} /></g>
              <g className="hand hand-r"><path d="M100 82c6 6 4 14 -4 16" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" /><circle cx="94" cy="99" r="4.5" fill={skin} /></g>
            </>
          )}
          {state === 'failed' && (
            <g className="alert"><circle cx="104" cy="18" r="10" fill="#d03b3b" /><rect x="102.6" y="11" width="2.8" height="9" rx="1.4" fill="#fff" /><circle cx="104" cy="23.5" r="1.6" fill="#fff" /></g>
          )}
        </g>
      )}
      {/* 机 */}
      <rect x="16" y="100" width="128" height="8" rx="3" fill="var(--office-desk-top)" />
      <rect x="22" y="108" width="116" height="24" rx="2" fill="var(--office-desk)" />
      {/* ノートPC（背面） */}
      <g className="laptop">
        <rect x="64" y="86" width="32" height="15" rx="2" fill="#9a988f" />
        <circle cx="80" cy="93" r="2.2" fill="#c3c2b7" />
        {state === 'working' && <rect className="screen-glow" x="62" y="84" width="36" height="3" rx="1.5" fill={color} opacity=".55" />}
      </g>
      <Prop kind={prop} color={color} />
      {!present && (
        <g transform="translate(26 84)"><rect width="34" height="16" rx="2" fill="#fff" stroke="#c3c2b7" /><text x="17" y="11.5" textAnchor="middle" fontSize="8" fill="#52514e">離席中</text></g>
      )}
    </svg>
  );
}

/** チャット用の小さな顔 */
export function StaffFace({ slug, size = 28 }) {
  if (!slug) {
    return <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true"><circle cx="14" cy="14" r="13" fill="#898781" /><path d="M8 15h12M14 9v12" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  const { color } = styleFor(slug);
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill={color} />
      <circle cx="14" cy="15" r="8.5" fill="#f6dcc2" />
      <path d="M5.5 14c0 -6 4 -9 8.5 -9s8.5 3 8.5 9c-2 -2.5 -5 -3.8 -8.5 -3.8s-6.5 1.3 -8.5 3.8z" fill={`color-mix(in srgb, ${color} 70%, #000)`} />
      <circle cx="11" cy="16" r="1.1" fill="#33312e" /><circle cx="17" cy="16" r="1.1" fill="#33312e" />
      <path d="M11.5 19q2.5 2 5 0" fill="none" stroke="#33312e" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
