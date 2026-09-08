import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, Sparkles, Megaphone, BarChart3, Scale, FileText, Settings,
  Bell, Search, Plus, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight,
  Play, MoreHorizontal, Clock3, CheckCircle2, AlertTriangle, Circle, Zap,
  Video, PenTool, Layers3, WandSparkles, Upload, X, CalendarDays, Bot
} from 'lucide-react';
import './styles.css';

const nav = [
  { label: 'ダッシュボード', icon: LayoutDashboard },
  { label: 'クリエイティブ', icon: Sparkles, count: 4 },
  { label: '広告運用', icon: Megaphone },
  { label: 'レポート', icon: BarChart3 },
  { label: '法務チェック', icon: Scale, count: 2 },
  { label: '契約・請求', icon: FileText },
];

const projects = [
  { name:'LUMINA 美容液', type:'動画広告', platform:'Meta', status:'生成中', color:'#7367f0', progress:68, updated:'3分前', owner:'LM' },
  { name:'NATURA サプリメント', type:'記事LP', platform:'Meta', status:'審査待ち', color:'#ffb545', progress:100, updated:'28分前', owner:'NT' },
  { name:'CORE FIT', type:'LP', platform:'Meta', status:'配信中', color:'#35b88f', progress:100, updated:'1時間前', owner:'CF' },
  { name:'MELLOW クレンジング', type:'動画広告', platform:'Meta', status:'修正あり', color:'#ef6a75', progress:84, updated:'2時間前', owner:'MW' },
];

function Logo(){ return <div className="logo"><div className="logoMark"><i/><i/><i/></div><b>ADFLOW</b></div> }

function Sidebar({active,setActive}){
  return <aside className="sidebar">
    <Logo/>
    <nav>{nav.map(({label,icon:Icon,count})=><button key={label} className={active===label?'active':''} onClick={()=>setActive(label)}><Icon size={18}/><span>{label}</span>{count&&<em>{count}</em>}</button>)}</nav>
    <div className="sideBottom">
      <button><Settings size={18}/><span>設定</span></button>
      <div className="support"><div className="supportIcon"><Zap size={18}/></div><b>お困りですか？</b><p>専任スタッフがサポートします</p><button>サポートに相談</button></div>
      <div className="profile"><div className="avatar">TA</div><div><b>田中 明</b><span>管理者</span></div><MoreHorizontal size={18}/></div>
    </div>
  </aside>
}

const Stat = ({title,value,unit,delta,down,icon:Icon,tone,foot}) => <div className="stat card">
  <div className={'statIcon '+tone}><Icon size={20}/></div><span className="statTitle">{title}</span>
  <div className="statValue">{value}<small>{unit}</small></div>
  <div className={'delta '+(down?'down':'')} >{down?<ArrowDownRight/>:<ArrowUpRight/>}{delta}</div>
  <p>{foot}</p>
</div>;

function Pipeline(){
  const items=[['素材アップロード','完了',Upload],['AI構成・台本生成','完了',Bot],['動画自動生成','処理中',Video],['AI編集・最適化','待機中',WandSparkles],['法務チェック','待機中',Scale]];
  return <section className="card pipeline"><div className="sectionHead"><div><h2>AIクリエイティブ制作</h2><p>制作フローをリアルタイムで確認</p></div><button className="linkBtn">すべて見る <ChevronRight size={16}/></button></div>
    <div className="projectMini"><div className="thumb gradientThumb"><Play fill="white" size={18}/></div><div><b>LUMINA 美容液｜縦型動画 15秒</b><span>Meta Reels・Stories　•　1080 × 1920</span></div><div className="percent"><b>68%</b><span>完了予定 14:30</span></div></div>
    <div className="flow">{items.map(([name,state,Icon],i)=><React.Fragment key={name}><div className={'flowItem s'+i}><div className="flowIcon">{state==='完了'?<CheckCircle2 size={19}/>:<Icon size={19}/>}</div><b>{name}</b><span>{state}</span></div>{i<items.length-1&&<div className={'connector '+(i<2?'done':'')}/>}</React.Fragment>)}</div>
  </section>
}

function Activity(){ const acts=[
  ['check','CORE FIT の広告配信を開始しました','Metaキャンペーン｜本日 10:24'],
  ['spark','LUMINA 美容液の動画を生成中です','AI Creative｜本日 10:12'],
  ['warn','MELLOW の法務チェックに要確認項目があります','薬機法チェック｜本日 09:45'],
  ['doc','昨日のデイリーレポートが完成しました','レポート｜本日 08:00']
]; return <section className="card activity"><div className="sectionHead"><div><h2>最近のアクティビティ</h2><p>ワークスペースの最新情報</p></div><button className="iconButton"><MoreHorizontal/></button></div><div className="activityList">{acts.map(([type,title,sub])=><div className="act" key={title}><div className={'actIcon '+type}>{type==='check'?<CheckCircle2/>:type==='spark'?<Sparkles/>:type==='warn'?<AlertTriangle/>:<FileText/>}</div><div><b>{title}</b><span>{sub}</span></div></div>)}</div></section> }

function Projects(){ const [filter,setFilter]=useState('すべて'); const shown=useMemo(()=>filter==='すべて'?projects:projects.filter(p=>p.status===filter),[filter]); return <section className="card projects"><div className="sectionHead"><div><h2>進行中のプロジェクト</h2><p>クリエイティブ制作から広告配信まで一元管理</p></div><div className="projectTools"><div className="filter">{['すべて','生成中','審査待ち','配信中'].map(x=><button onClick={()=>setFilter(x)} className={filter===x?'selected':''} key={x}>{x}</button>)}</div><button className="linkBtn">すべて見る <ChevronRight size={16}/></button></div></div>
  <div className="tableWrap"><table><thead><tr><th>プロジェクト</th><th>種別</th><th>ステータス</th><th>進捗</th><th>最終更新</th><th></th></tr></thead><tbody>{shown.map(p=><tr key={p.name}><td><div className="projectName"><div className="brandAvatar" style={{background:p.color}}>{p.owner}</div><div><b>{p.name}</b><span>{p.platform} キャンペーン</span></div></div></td><td><span className="typeIcon">{p.type==='動画広告'?<Video/>:p.type==='記事LP'?<PenTool/>:<Layers3/>}</span>{p.type}</td><td><span className={'status '+p.status}>{p.status==='生成中'&&<i/>}{p.status==='審査待ち'&&<Clock3/>}{p.status==='配信中'&&<CheckCircle2/>}{p.status==='修正あり'&&<AlertTriangle/>}{p.status}</span></td><td><div className="progressCell"><div><i style={{width:p.progress+'%',background:p.color}}/></div><span>{p.progress}%</span></div></td><td className="muted">{p.updated}</td><td><button className="iconButton"><MoreHorizontal/></button></td></tr>)}</tbody></table></div></section> }

function QuickStart({onOpen}){return <section className="card quick"><div><span className="eyebrow"><Sparkles size={14}/> AI POWERED</span><h2>新しいクリエイティブを<br/>制作しましょう</h2><p>素材をアップロードするだけ。AIが構成から<br/>編集、法務チェックまで自動で行います。</p><button className="primary" onClick={onOpen}><Plus size={18}/> 制作をはじめる</button></div><div className="orb"><div className="ring r1"/><div className="ring r2"/><Sparkles size={38}/></div></section>}

function Modal({close}){const [done,setDone]=useState(false); return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><button className="close" onClick={close}><X/></button>{done?<div className="success"><div><CheckCircle2/></div><h2>制作依頼を受け付けました</h2><p>AIが素材を解析し、最適な制作フローを開始します。</p><button className="primary" onClick={close}>ダッシュボードへ戻る</button></div>:<><span className="eyebrow"><Sparkles size={14}/> NEW CREATIVE</span><h2>クリエイティブ制作を依頼</h2><p className="modalLead">必要な情報を入力してください。AIが制作から法務確認まで進行します。</p><label>プロジェクト名<input placeholder="例：LUMINA 新商品キャンペーン"/></label><div className="twoCols"><label>制作物<select><option>動画広告</option><option>記事LP</option><option>ランディングページ</option></select></label><label>配信先<select><option>Meta（Instagram / Facebook）</option><option>その他</option></select></label></div><label>制作素材<div className="drop"><Upload/><b>ファイルをドロップ、またはクリックして選択</b><span>動画・画像・商品資料（最大 500MB）</span></div></label><button className="primary full" onClick={()=>setDone(true)}><Sparkles size={18}/> AI制作を開始</button></>}</div></div>}

function Dashboard(){
  const [active,setActive]=useState('ダッシュボード');
  const [modal,setModal]=useState(false);
  const [toast,setToast]=useState(false);
  const ActiveIcon=nav.find(n=>n.label===active)?.icon || LayoutDashboard;
  return <div className="app"><Sidebar active={active} setActive={setActive}/><main><header><div><h1>{active}</h1><p>おはようございます、田中さん。今日も広告運用を最適化しましょう。</p></div><div className="headerActions"><div className="search"><Search/><input placeholder="検索"/><kbd>⌘ K</kbd></div><button className="bell" onClick={()=>{setToast(true);setTimeout(()=>setToast(false),2500)}}><Bell/><i/></button><button className="primary" onClick={()=>setModal(true)}><Plus/> 新規プロジェクト</button></div></header>{active==='ダッシュボード'?<><div className="notice"><div><Sparkles/><b>AIアップデート</b><span>動画生成モデルがアップデートされました。より自然で高品質な映像を生成できます。</span></div><button>詳細を見る <ChevronRight/></button></div><div className="stats"><Stat title="広告売上" value="¥12,846,320" delta="18.4%" icon={BarChart3} tone="purple" foot="前月比"/><Stat title="広告費" value="¥3,241,800" delta="8.2%" icon={Megaphone} tone="orange" foot="前月比"/><Stat title="ROAS" value="396" unit="%" delta="24.6%" icon={ArrowUpRight} tone="green" foot="目標 350%"/><Stat title="制作中クリエイティブ" value="8" unit="件" delta="2件" down icon={Sparkles} tone="pink" foot="先週比"/></div><div className="mainGrid"><div><Pipeline/><Projects/></div><div><QuickStart onOpen={()=>setModal(true)}/><Activity/><section className="card report"><div className="reportIcon"><CalendarDays/></div><div><span>DAILY REPORT</span><b>本日のレポートは<br/>明日 8:00 に生成されます</b><a>レポート設定 <ArrowUpRight/></a></div></section></div></div></>:<div className="emptyState card"><div><ActiveIcon size={30}/></div><h2>{active}</h2><p>この機能はダッシュボードから一元管理できます。データ連携後、ここに詳細が表示されます。</p><button className="primary" onClick={()=>setActive('ダッシュボード')}>ダッシュボードへ戻る</button></div>}</main>{modal&&<Modal close={()=>setModal(false)}/>} {toast&&<div className="toast"><CheckCircle2/> 新しい通知はありません</div>}</div>
}

createRoot(document.getElementById('root')).render(<Dashboard/>);
