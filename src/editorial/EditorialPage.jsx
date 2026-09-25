import React, { useMemo, useState } from 'react';
import {
  Lightbulb, Repeat2, CalendarRange, TrendingUp, Coins, ShieldCheck, AlertTriangle,
  CheckCircle2, Plus, Copy, Flag, Circle,
} from 'lucide-react';
import {
  rankTopics, planSchedule, allocateMix, repurposeNote, findNearDuplicates,
  funnel, extractPatterns, insights, PHASES, currentPhase,
} from './engine.js';
import { concept, loopSteps, topics as initialTopics, sampleNote, performance, revenueLadder, phaseStats } from './data.js';

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const yen = (v) => `¥${Math.round(v).toLocaleString('ja-JP')}`;

function Head({ icon: Icon, title, sub, children }) {
  return <div className="sectionHead"><div className="edTitle"><span className="edIcon"><Icon size={15} /></span><div><h2>{title}</h2><p>{sub}</p></div></div>{children}</div>;
}

function Loop() {
  const phase = currentPhase(phaseStats);
  return <section className="card edLoop">
    <div className="edConcept">
      <span className="eyebrow">AI EDITORIAL</span>
      <h2>{concept.position}</h2>
      <p>{concept.axis}　•　{concept.edge}</p>
    </div>
    <div className="edSteps">{loopSteps.map((s) => <div key={s.no} className="edStep"><b>{s.no} {s.title}</b><span>{s.desc}</span></div>)}</div>
    <div className="edPhases">{PHASES.map((p) => <div key={p.id} className={'edPhase ' + (p.id < phase.id ? 'done' : p.id === phase.id ? 'now' : '')}>
      {p.id < phase.id ? <CheckCircle2 size={13} /> : p.id === phase.id ? <Flag size={13} /> : <Circle size={13} />}<span>Phase {p.id}</span><b>{p.name}</b>
    </div>)}</div>
  </section>;
}

function Topics() {
  const [list, setList] = useState(initialTopics);
  const [draft, setDraft] = useState({ name: '', search: 5, xReaction: 5, competition: 5, monetizable: 5 });
  const ranked = useMemo(() => rankTopics(list), [list]);
  const add = () => { if (!draft.name.trim()) return; setList([...list, { ...draft, source: '手動' }]); setDraft({ ...draft, name: '' }); };
  const fields = [['search', '検索需要'], ['xReaction', 'X反応'], ['competition', '競合'], ['monetizable', '有料化']];
  return <section className="card edTopics">
    <Head icon={Lightbulb} title="今日のネタ候補" sub="検索需要・X反応・競合の少なさ・有料化しやすさでスコアリング" />
    <div className="tableWrap"><table><thead><tr><th>テーマ</th><th>出所</th>{fields.map(([, l]) => <th key={l}>{l}</th>)}<th>スコア</th><th>判定</th></tr></thead>
      <tbody>{ranked.map((t) => <tr key={t.name}><td><b>{t.name}</b></td><td className="muted">{t.source}</td>{fields.map(([k]) => <td key={k}>{t[k]}</td>)}
        <td><div className="progressCell"><div><i style={{ width: t.total + '%', background: '#6657df' }} /></div><span>{t.total}</span></div></td>
        <td><span className={'edVerdict v' + t.verdict}>{t.verdict}</span></td></tr>)}</tbody></table></div>
    <div className="edAdd">
      <input placeholder="新しいネタ" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      {fields.map(([k, l]) => <label key={k}>{l}<input type="number" min="0" max="10" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} /></label>)}
      <button className="primary" onClick={add}><Plus /> 追加</button>
    </div>
  </section>;
}

function Repurpose() {
  const [note, setNote] = useState({ ...sampleNote, points: sampleNote.keyPoints.join('\n') });
  const drafts = useMemo(() => repurposeNote({ ...note, keyPoints: note.points.split('\n').map((s) => s.trim()).filter(Boolean) }), [note]);
  const dups = useMemo(() => findNearDuplicates(drafts), [drafts]);
  const dupIds = new Set(dups.flatMap((d) => [d.a, d.b]));
  const set = (k) => (e) => setNote({ ...note, [k]: e.target.value });
  return <section className="card edRepurpose">
    <Head icon={Repeat2} title="note → X 変換" sub="1本のnoteから 短文×3・ノウハウ×2・長文×1・誘導×1 を生成" />
    <div className="edRepGrid">
      <div className="edForm">
        <label>タイトル<input value={note.title} onChange={set('title')} /></label>
        <label>Hook（冒頭の一文）<input value={note.hook} onChange={set('hook')} /></label>
        <label>要点（1行1つ）<textarea rows="4" value={note.points} onChange={set('points')} /></label>
        <label>結果・一次情報<input value={note.result} onChange={set('result')} /></label>
        <label>note URL<input value={note.url} onChange={set('url')} /></label>
        <div className={'edGuard ' + (dups.length ? 'warn' : 'ok')}>{dups.length ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
          {dups.length ? `類似投稿 ${dups.length} 組を検出。Xの自動化ルール（同一・類似投稿の連投禁止）に抵触しないよう書き分けてください。` : '類似投稿なし。予約投稿OK（X API経由・人間の最終確認後）'}</div>
      </div>
      <div className="edDrafts">{drafts.map((d) => <div key={d.id} className={'edDraft ' + (dupIds.has(d.id) ? 'dup' : '')}>
        <div><span className={'edTag c' + d.category}>{d.label}</span><button className="iconButton" title="コピー" onClick={() => navigator.clipboard?.writeText(d.text)}><Copy size={13} /></button></div>
        <p>{d.text}</p><small>{d.text.length} 文字</small>
      </div>)}</div>
    </div>
  </section>;
}

function Schedule() {
  const [perDay, setPerDay] = useState(3);
  const plan = useMemo(() => planSchedule(perDay, 7), [perDay]);
  const mix = allocateMix(perDay * 7);
  return <section className="card edSchedule">
    <Head icon={CalendarRange} title="X 週間投稿プラン" sub="価値50%・実験20%・考察20%・導線10%。宣伝アカウントにしない">
      <label className="edPerDay">1日<input type="number" min="1" max="10" value={perDay} onChange={(e) => setPerDay(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />本</label>
    </Head>
    <div className="edMix">{mix.map((m) => <span key={m.key} className={'edTag c' + m.key}>{m.label} {m.count}本</span>)}</div>
    <div className="edWeek">{plan.map((d) => <div key={d.day}><b>Day {d.day}</b>{d.posts.map((p, i) => <span key={i} className={'edSlot c' + p.key}>{p.label}</span>)}</div>)}</div>
  </section>;
}

function Analytics() {
  const total = performance.reduce((t, r) => { Object.keys(r).forEach((k) => typeof r[k] === 'number' && (t[k] = (t[k] || 0) + r[k])); return t; }, {});
  const steps = funnel(total);
  const found = insights(extractPatterns(performance));
  const revenue = performance.reduce((s, r) => s + r.price * r.purchases, 0);
  return <section className="card edAnalytics">
    <Head icon={TrendingUp} title="データ分析 → 勝ちパターンDB" sub={`直近 ${performance.length} 記事　•　売上 ${yen(revenue)}`} />
    <div className="edFunnel">{steps.map((s, i) => <div key={s.label}><span>{s.label}</span><b>{s.value.toLocaleString('ja-JP')}</b>{i > 0 && <em>{pct(s.stepRate)}</em>}</div>)}</div>
    <ul className="edInsights">{found.map((f) => <li key={f.dimension + f.value}><CheckCircle2 size={14} /><div><b>{f.text}</b><span>{f.note}</span></div></li>)}</ul>
  </section>;
}

function Ladder() {
  return <section className="card edLadder">
    <Head icon={Coins} title="収益の階段" sub="X → 無料note → 複線化した収益源" />
    <ol>{revenueLadder.map((r, i) => <li key={r.name} className={r.core ? '' : 'sub'}><em>{i + 1}</em><div><b>{r.name}</b><span>{r.role}</span></div>{!r.core && <small>副次</small>}</li>)}</ol>
    <p className="edNote">noteの公開は人間が最終チェックして行う（下書き生成までを自動化）。</p>
  </section>;
}

export default function EditorialPage() {
  return <div className="edPage">
    <Loop />
    <div className="edGrid"><Topics /><Ladder /></div>
    <Repurpose />
    <div className="edGrid"><Schedule /><Analytics /></div>
  </div>;
}
