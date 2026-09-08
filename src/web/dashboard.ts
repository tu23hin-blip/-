/**
 * 管理ダッシュボード。ビルド不要の単一 HTML。
 * APIキーはブラウザの localStorage にのみ保持し、サーバ側には保存しない。
 */
export function dashboardHtml(): string {
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>メディア自走ASP コンソール</title>
<style>
 :root{--bg:#0b1120;--panel:#111827;--panel2:#0f1729;--fg:#e5e7eb;--muted:#94a3b8;--line:#1f2937;
       --accent:#3b82f6;--good:#10b981;--warn:#f59e0b;--bad:#ef4444}
 @media (prefers-color-scheme:light){:root{--bg:#f5f6f8;--panel:#fff;--panel2:#fafbfc;--fg:#111827;--muted:#6b7280;--line:#e5e7eb}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,"Hiragino Kaku Gothic ProN",sans-serif;font-size:14px;line-height:1.6}
 header{position:sticky;top:0;z-index:10;background:var(--panel);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
 header h1{font-size:15px;margin:0;font-weight:700}
 header .spacer{flex:1}
 input,select,button,textarea{font:inherit;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
 button{cursor:pointer;background:var(--accent);color:#fff;border-color:transparent;font-weight:600}
 button.ghost{background:transparent;color:var(--fg);border-color:var(--line);font-weight:500}
 button:disabled{opacity:.5;cursor:not-allowed}
 main{max-width:1280px;margin:0 auto;padding:20px}
 nav{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}
 nav button{background:transparent;color:var(--muted);border:1px solid var(--line)}
 nav button.on{background:var(--accent);color:#fff;border-color:transparent}
 section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
 h2{font-size:13px;color:var(--muted);margin:0 0 14px;letter-spacing:.05em;text-transform:uppercase}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
 th{color:var(--muted);font-size:11px;font-weight:600}
 td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
 .card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px}
 .card .l{font-size:11px;color:var(--muted)} .card .v{font-size:20px;font-weight:700;margin-top:2px}
 .pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;background:var(--line);white-space:nowrap}
 .pill.good{background:rgba(16,185,129,.18);color:var(--good)}
 .pill.warn{background:rgba(245,158,11,.18);color:var(--warn)}
 .pill.bad{background:rgba(239,68,68,.18);color:var(--bad)}
 .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
 .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
 @media(max-width:840px){.grid2{grid-template-columns:1fr}}
 pre{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:11px;max-height:340px}
 a{color:var(--accent)}
 .muted{color:var(--muted);font-size:12px}
 .steps{display:flex;gap:4px;flex-wrap:wrap}
 .step{font-size:10px;padding:2px 7px;border-radius:6px;background:var(--line);color:var(--muted)}
 .step.succeeded{background:rgba(16,185,129,.18);color:var(--good)}
 .step.running{background:rgba(59,130,246,.2);color:var(--accent)}
 .step.failed{background:rgba(239,68,68,.18);color:var(--bad)}
 .step.skipped{opacity:.5}
 label{font-size:12px;color:var(--muted);display:block;margin-bottom:3px}
 .field{margin-bottom:10px}
 textarea{width:100%;min-height:110px;font-family:ui-monospace,monospace;font-size:12px}
 #toast{position:fixed;right:18px;bottom:18px;background:var(--panel);border:1px solid var(--line);
        border-radius:10px;padding:12px 16px;max-width:380px;display:none;box-shadow:0 8px 24px rgba(0,0,0,.3)}
</style></head><body>
<header>
  <h1>メディア自走ASP コンソール</h1>
  <span class="pill" id="status">接続待ち</span>
  <div class="spacer"></div>
  <input id="apiKey" type="password" placeholder="APIキー" style="width:230px">
  <select id="project" style="min-width:200px"></select>
  <button class="ghost" onclick="boot()">再読込</button>
</header>
<main>
  <nav>
    <button class="on" data-tab="overview">概要</button>
    <button data-tab="orders">発注・制作</button>
    <button data-tab="meta">運用（Meta）</button>
    <button data-tab="legal">法務</button>
    <button data-tab="finance">契約・請求</button>
    <button data-tab="reports">レポート</button>
    <button data-tab="jobs">ジョブ</button>
  </nav>
  <div id="view"></div>
</main>
<div id="toast"></div>
<script>
const S = { key:'', projects:[], projectId:'', tab:'overview', data:{} };

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { 'content-type':'application/json', authorization: 'Bearer ' + S.key, ...(options.headers||{}) },
  }).then(async (r) => {
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) throw new Error(body && body.message ? body.message : ('HTTP ' + r.status));
    return body;
  });
}
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block';
  el.style.borderColor = isError ? 'var(--bad)' : 'var(--line)';
  setTimeout(() => { el.style.display = 'none'; }, 4200);
}
const yen = (v) => '¥' + Math.round(v||0).toLocaleString('ja-JP');
const num = (v) => (v||0).toLocaleString('ja-JP');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function boot() {
  S.key = document.getElementById('apiKey').value.trim();
  localStorage.setItem('asp_key', S.key);
  try {
    const status = await api('/api/status');
    document.getElementById('status').textContent =
      'LLM:' + status.providers.llm.effective + ' / 動画:' + status.providers.video.effective +
      ' / Meta:' + (status.providers.meta.enabled ? '本番' : 'サンドボックス');
    document.getElementById('status').className = 'pill good';
    S.projects = await api('/api/projects');
    const sel = document.getElementById('project');
    sel.innerHTML = S.projects.map((p) => '<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
    if (!S.projectId || !S.projects.some((p) => p.id === S.projectId)) S.projectId = S.projects[0] ? S.projects[0].id : '';
    sel.value = S.projectId;
    render();
  } catch (e) {
    document.getElementById('status').textContent = e.message;
    document.getElementById('status').className = 'pill bad';
  }
}

async function render() {
  const view = document.getElementById('view');
  view.innerHTML = '<section class="muted">読み込み中…</section>';
  try {
    if (S.tab === 'overview') return void (view.innerHTML = await viewOverview());
    if (S.tab === 'orders') return void (view.innerHTML = await viewOrders());
    if (S.tab === 'meta') return void (view.innerHTML = await viewMeta());
    if (S.tab === 'legal') return void (view.innerHTML = await viewLegal());
    if (S.tab === 'finance') return void (view.innerHTML = await viewFinance());
    if (S.tab === 'reports') return void (view.innerHTML = await viewReports());
    if (S.tab === 'jobs') return void (view.innerHTML = await viewJobs());
  } catch (e) {
    view.innerHTML = '<section><span class="pill bad">エラー</span> ' + esc(e.message) + '</section>';
  }
}

async function viewOverview() {
  if (!S.projectId) return '<section>案件がありません。<code>npm run seed</code> でサンプルを作成できます。</section>';
  const [project, ins, orders] = await Promise.all([
    api('/api/projects/' + S.projectId),
    api('/api/projects/' + S.projectId + '/insights'),
    api('/api/orders?projectId=' + S.projectId + '&limit=8'),
  ]);
  const t = ins.total;
  const cpaClass = project.target_cpa && t.cpa ? (t.cpa <= project.target_cpa ? 'good' : 'bad') : '';
  return \`
  <section>
    <h2>案件</h2>
    <div class="row">
      <span class="pill">クライアント: \${esc(project.client?.name)}</span>
      <span class="pill">代理店: \${esc(project.agency?.name)}</span>
      <span class="pill">メディア: \${esc(project.media?.name)}</span>
      <span class="pill">広告主: \${esc(project.advertiser?.name)}（\${esc(project.advertiser?.category)}）</span>
      <span class="pill \${project.autopilot_level==='off'?'':'good'}">自動運用: \${esc(project.autopilot_level)}</span>
    </div>
    <div class="cards">
      <div class="card"><div class="l">消化（14日）</div><div class="v">\${yen(t.spend)}</div></div>
      <div class="card"><div class="l">CV</div><div class="v">\${num(t.conversions)}</div></div>
      <div class="card"><div class="l">CPA</div><div class="v \${cpaClass}">\${t.cpa?yen(t.cpa):'—'}</div></div>
      <div class="card"><div class="l">目標CPA</div><div class="v">\${project.target_cpa?yen(project.target_cpa):'—'}</div></div>
      <div class="card"><div class="l">ROAS</div><div class="v">\${t.roas.toFixed(2)}</div></div>
      <div class="card"><div class="l">CTR</div><div class="v">\${t.ctr.toFixed(2)}%</div></div>
      <div class="card"><div class="l">月予算</div><div class="v">\${yen(project.monthly_budget)}</div></div>
    </div>
    <div class="muted">\${ins.sandbox ? 'Meta はサンドボックスモードです（数値はシミュレーション）。' : 'Meta 本番アカウントに接続中。'}</div>
  </section>
  <section><h2>日次推移</h2>
    <table><thead><tr><th>日付</th><th class="num">消化</th><th class="num">IMP</th><th class="num">CTR</th><th class="num">CV</th><th class="num">CPA</th></tr></thead>
    <tbody>\${ins.daily.map((d)=>'<tr><td>'+d.date+'</td><td class="num">'+yen(d.spend)+'</td><td class="num">'+num(d.impressions)+'</td><td class="num">'+d.ctr.toFixed(2)+'%</td><td class="num">'+d.conversions+'</td><td class="num">'+(d.cpa?yen(d.cpa):'—')+'</td></tr>').join('') || '<tr><td colspan="6" class="muted">実績がありません</td></tr>'}</tbody></table>
  </section>
  <section><h2>直近の発注</h2>
    <table><thead><tr><th>件名</th><th>種別</th><th>状態</th><th>納品物</th></tr></thead>
    <tbody>\${orders.map((o)=>'<tr><td>'+esc(o.title)+(o.auto_generated?' <span class="pill">自動</span>':'')+'</td><td>'+o.type+'</td><td><span class="pill">'+esc(o.statusLabel)+'</span></td><td><a href="#" onclick="openOrder(\\''+o.id+'\\');return false">詳細</a></td></tr>').join('') || '<tr><td colspan="4" class="muted">発注がありません</td></tr>'}</tbody></table>
  </section>\`;
}

async function viewOrders() {
  const orders = await api('/api/orders?projectId=' + S.projectId + '&limit=50');
  return \`
  <section>
    <h2>新規発注（依頼するとメディア側が自動で制作します）</h2>
    <div class="grid2">
      <div>
        <div class="field"><label>種別</label>
          <select id="oType">
            <option value="video_ad">動画広告</option>
            <option value="article_lp">記事LP</option>
            <option value="lp">LP</option>
            <option value="meta_operation">Meta運用</option>
          </select></div>
        <div class="field"><label>件名</label><input id="oTitle" style="width:100%" placeholder="9月分 新規クリエイティブ"></div>
        <div class="field"><label>本数</label><input id="oQty" type="number" value="2" min="1" max="10"></div>
        <button onclick="createOrder()">発注する</button>
      </div>
      <div class="field"><label>ブリーフ（JSON）</label>
        <textarea id="oBrief">{
  "product": "商品名",
  "target": "30代女性・肌の乾燥が気になる",
  "painPoints": ["夕方に乾燥する", "何を選べばいいか分からない"],
  "usp": ["高保湿成分配合", "無香料・無着色", "初回限定価格"],
  "offer": "初回限定 2,980円",
  "tone": "落ち着いた信頼感",
  "durationSec": 20,
  "aspectRatios": ["9:16"],
  "variations": 2,
  "cta": "公式サイトを見る"
}</textarea></div>
    </div>
  </section>
  <section><h2>発注一覧</h2>
    <table><thead><tr><th>件名</th><th>種別</th><th>状態</th><th>本数</th><th>作成</th><th></th></tr></thead>
    <tbody>\${orders.map((o)=>'<tr><td>'+esc(o.title)+(o.auto_generated?' <span class="pill">自動発注</span>':'')+'</td><td>'+o.type+'</td><td><span class="pill">'+esc(o.statusLabel)+'</span></td><td>'+o.quantity+'</td><td class="muted">'+o.created_at.slice(0,16).replace('T',' ')+'</td><td><a href="#" onclick="openOrder(\\''+o.id+'\\');return false">詳細</a></td></tr>').join('') || '<tr><td colspan="6" class="muted">発注がありません</td></tr>'}</tbody></table>
  </section>
  <section id="orderDetail" style="display:none"></section>\`;
}

async function openOrder(id) {
  const o = await api('/api/orders/' + id);
  const box = document.getElementById('orderDetail');
  if (!box) { S.tab='orders'; setTab('orders'); return; }
  box.style.display = 'block';
  box.innerHTML = \`<h2>\${esc(o.title)}</h2>
   <div class="row"><span class="pill">\${esc(o.statusLabel)}</span>
     \${(o.allowedTransitions||[]).map((t)=>'<button class="ghost" onclick="moveOrder(\\''+o.id+'\\',\\''+t+'\\')">'+t+'へ</button>').join('')}
     <button class="ghost" onclick="rerun('\${o.id}')">パイプライン再実行</button></div>
   \${o.pipeline ? '<div class="steps">'+o.pipeline.steps.map((s)=>'<span class="step '+s.status+'" title="'+esc(s.error||'')+'">'+esc(s.label)+'</span>').join('')+'</div>' : ''}
   \${o.pipeline && o.pipeline.error ? '<div class="pill bad" style="margin-top:8px">'+esc(o.pipeline.error)+'</div>' : ''}
   <h2 style="margin-top:18px">納品物</h2>
   <table><thead><tr><th>タイトル</th><th>種別</th><th>状態</th><th>法務</th><th>プレビュー</th></tr></thead><tbody>
   \${o.deliverables.map((d)=>'<tr><td>'+esc(d.title)+'</td><td>'+d.kind+'</td><td><span class="pill">'+esc(d.status)+'</span></td><td><span class="pill '+(d.legal_status==='pass'?'good':d.legal_status==='block'?'bad':'warn')+'">'+d.legal_status+'</span></td><td>'+(d.previewUrl?'<a target="_blank" href="'+d.previewUrl+'">開く</a>':'—')+'</td></tr>').join('') || '<tr><td colspan="5" class="muted">まだありません</td></tr>'}
   </tbody></table>
   <h2 style="margin-top:18px">使用素材（AI生成＋提供素材のみ）</h2>
   <table><thead><tr><th>出所</th><th>種別</th><th>プロバイダ</th><th>ファイル</th></tr></thead><tbody>
   \${o.assets.slice(0,40).map((a)=>'<tr><td><span class="pill '+(a.source==='client_provided'?'good':'')+'">'+(a.source==='ai_generated'?'AI生成':a.source==='client_provided'?'提供素材':'派生')+'</span></td><td>'+a.kind+'</td><td class="muted">'+esc(a.provider||'—')+'</td><td><a target="_blank" href="'+a.url+'">開く</a></td></tr>').join('') || '<tr><td colspan="4" class="muted">まだありません</td></tr>'}
   </tbody></table>\`;
  box.scrollIntoView({ behavior:'smooth' });
}

async function createOrder() {
  try {
    const brief = JSON.parse(document.getElementById('oBrief').value);
    const r = await api('/api/orders', { method:'POST', body: JSON.stringify({
      project_id: S.projectId,
      type: document.getElementById('oType').value,
      title: document.getElementById('oTitle').value || '新規発注',
      quantity: Number(document.getElementById('oQty').value || 1),
      brief,
    })});
    toast('発注しました。制作パイプラインを開始します（' + r.id + '）');
    render();
  } catch (e) { toast(e.message, true); }
}
async function moveOrder(id, to) {
  try { await api('/api/orders/'+id+'/transition', { method:'POST', body: JSON.stringify({ to }) }); toast('状態を更新しました'); openOrder(id); }
  catch (e) { toast(e.message, true); }
}
async function rerun(id) {
  try { await api('/api/orders/'+id+'/rerun', { method:'POST', body:'{}' }); toast('再実行を投入しました'); }
  catch (e) { toast(e.message, true); }
}

async function viewMeta() {
  const [ins, objects, actions] = await Promise.all([
    api('/api/projects/'+S.projectId+'/insights'),
    api('/api/projects/'+S.projectId+'/meta/objects'),
    api('/api/projects/'+S.projectId+'/optimizer-actions?limit=30'),
  ]);
  return \`
  <section><h2>操作</h2><div class="row">
    <button onclick="metaAction('sync')">実績を取り込む</button>
    <button onclick="metaAction('optimize')">最適化を実行</button>
    <button class="ghost" onclick="metaAction('activate')">配信を開始</button>
    <button class="ghost" onclick="backfill()">過去14日を生成</button>
  </div><div class="muted">\${ins.sandbox?'サンドボックス動作中：META_ENABLED=true とトークン設定で本番アカウントに切り替わります。':'本番アカウントに接続中です。'}</div></section>
  <section><h2>広告構成</h2>
    <table><thead><tr><th>階層</th><th>名称</th><th>状態</th><th class="num">日予算</th><th>リモートID</th></tr></thead><tbody>
    \${objects.map((o)=>'<tr><td>'+o.level+'</td><td>'+esc(o.name)+'</td><td><span class="pill '+(o.status==='ACTIVE'?'good':'')+'">'+o.status+'</span></td><td class="num">'+(o.daily_budget?yen(o.daily_budget):'—')+'</td><td class="muted">'+esc(o.remote_id||'—')+'</td></tr>').join('') || '<tr><td colspan="5" class="muted">未入稿です</td></tr>'}
    </tbody></table></section>
  <section><h2>クリエイティブ別実績（14日）</h2>
    <table><thead><tr><th>広告</th><th>状態</th><th class="num">消化</th><th class="num">CTR</th><th class="num">CV</th><th class="num">CPA</th><th class="num">FRQ</th></tr></thead><tbody>
    \${ins.byObject.map((o)=>'<tr><td>'+esc(o.name)+'</td><td><span class="pill '+(o.status==='ACTIVE'?'good':'')+'">'+o.status+'</span></td><td class="num">'+yen(o.spend)+'</td><td class="num">'+o.ctr.toFixed(2)+'%</td><td class="num">'+o.conversions+'</td><td class="num">'+(o.cpa?yen(o.cpa):'—')+'</td><td class="num">'+o.frequency.toFixed(2)+'</td></tr>').join('') || '<tr><td colspan="7" class="muted">実績がありません</td></tr>'}
    </tbody></table></section>
  <section><h2>自動運用アクション</h2>
    <table><thead><tr><th>日付</th><th>ルール</th><th>対象</th><th>アクション</th><th>適用</th><th>理由</th></tr></thead><tbody>
    \${actions.map((a)=>'<tr><td>'+a.date+'</td><td>'+esc(a.rule)+'</td><td>'+esc(a.object_name||'—')+'</td><td>'+esc(a.action)+'</td><td><span class="pill '+(a.applied?'good':'warn')+'">'+(a.applied?'実施':'提案')+'</span></td><td class="muted">'+esc(a.reason)+'</td></tr>').join('') || '<tr><td colspan="6" class="muted">まだありません</td></tr>'}
    </tbody></table></section>\`;
}
async function metaAction(kind) {
  try {
    const r = await api('/api/projects/'+S.projectId+'/meta/'+kind, { method:'POST', body:'{}' });
    toast(kind + ' 完了: ' + JSON.stringify(r).slice(0,140));
    render();
  } catch (e) { toast(e.message, true); }
}
async function backfill() {
  try { await api('/api/projects/'+S.projectId+'/meta/sync', { method:'POST', body: JSON.stringify({ days: 14 }) }); toast('過去14日の実績を生成しました'); render(); }
  catch (e) { toast(e.message, true); }
}

async function viewLegal() {
  const [reviews, summary] = await Promise.all([
    api('/api/legal/reviews?projectId='+S.projectId+'&limit=40'),
    api('/api/legal/summary?projectId='+S.projectId),
  ]);
  return \`
  <section><h2>表現チェック（薬機法・景表法）</h2>
    <div class="grid2">
      <div>
        <div class="field"><label>カテゴリ</label><select id="lcat">
          <option value="cosmetics">化粧品</option><option value="quasi_drug">医薬部外品</option>
          <option value="supplement">健康食品・サプリ</option><option value="food_with_claims">機能性表示食品</option>
          <option value="medical_device">医療機器</option><option value="general">一般</option>
        </select></div>
        <button onclick="runCheck()">チェックする</button>
        <div class="cards" style="margin-top:14px">
          <div class="card"><div class="l">審査件数</div><div class="v">\${summary.total}</div></div>
          <div class="card"><div class="l">合格</div><div class="v" style="color:var(--good)">\${summary.pass}</div></div>
          <div class="card"><div class="l">要注意</div><div class="v" style="color:var(--warn)">\${summary.warn}</div></div>
          <div class="card"><div class="l">差止</div><div class="v" style="color:var(--bad)">\${summary.block}</div></div>
        </div>
      </div>
      <div class="field"><label>チェック対象テキスト</label>
        <textarea id="ltext">飲むだけでシミが消える！医師も推薦する話題のサプリ。効果は100%保証、業界No.1の実績。</textarea></div>
    </div>
    <div id="lresult"></div>
  </section>
  <section><h2>審査履歴</h2>
    <table><thead><tr><th>日時</th><th>対象</th><th>判定</th><th class="num">スコア</th><th class="num">指摘</th></tr></thead><tbody>
    \${reviews.map((r)=>'<tr><td class="muted">'+r.created_at.slice(0,16).replace('T',' ')+'</td><td>'+esc(r.subject_type)+'</td><td><span class="pill '+(r.status==='pass'?'good':r.status==='block'?'bad':'warn')+'">'+r.status+'</span></td><td class="num">'+r.score+'</td><td class="num">'+(r.findings||[]).length+'</td></tr>').join('') || '<tr><td colspan="5" class="muted">履歴がありません</td></tr>'}
    </tbody></table></section>\`;
}
async function runCheck() {
  try {
    const r = await api('/api/legal/check', { method:'POST', body: JSON.stringify({
      text: document.getElementById('ltext').value,
      category: document.getElementById('lcat').value,
      projectId: S.projectId, deep: true, autoRevise: true,
    })});
    document.getElementById('lresult').innerHTML =
      '<div class="row" style="margin-top:14px"><span class="pill '+(r.status==='pass'?'good':r.status==='block'?'bad':'warn')+'">判定: '+r.status+'</span><span class="pill">スコア '+r.score+'</span></div>' +
      '<table><thead><tr><th>重篤度</th><th>該当箇所</th><th>根拠</th><th>修正案</th></tr></thead><tbody>' +
      r.findings.map((f)=>'<tr><td><span class="pill '+(f.severity==='block'?'bad':f.severity==='warn'?'warn':'')+'">'+f.severity+'</span></td><td>'+esc(f.phrase)+'</td><td class="muted">'+esc(f.reason)+'</td><td class="muted">'+esc(f.suggestion||'—')+'</td></tr>').join('') +
      '</tbody></table>' + (r.revisedText ? '<h2 style="margin-top:16px">修正案</h2><pre>'+esc(r.revisedText)+'</pre>' : '');
    render_noop();
  } catch (e) { toast(e.message, true); }
}
function render_noop(){}

async function viewFinance() {
  const [invoices, contracts, ledger] = await Promise.all([
    api('/api/invoices?projectId='+S.projectId),
    api('/api/contracts?projectId='+S.projectId),
    api('/api/projects/'+S.projectId+'/ledger'),
  ]);
  return \`
  <section><h2>収支（当月）</h2><div class="cards">
    <div class="card"><div class="l">クライアント売上</div><div class="v">\${yen(ledger.clientRevenue)}</div></div>
    <div class="card"><div class="l">メディア原価</div><div class="v">\${yen(ledger.mediaCost)}</div></div>
    <div class="card"><div class="l">広告費</div><div class="v">\${yen(ledger.adSpend)}</div></div>
    <div class="card"><div class="l">代理店マージン</div><div class="v">\${yen(ledger.agencyMargin)}</div></div>
    <div class="card"><div class="l">メディア利益</div><div class="v">\${yen(ledger.mediaProfit)}</div></div>
  </div>
  <div class="row"><button onclick="makeInvoice('receivable')">請求書を作成</button>
  <button class="ghost" onclick="makeInvoice('payable')">支払通知書を作成</button>
  <button class="ghost" onclick="makeContract()">基本契約書を作成</button></div></section>
  <section><h2>請求書</h2>
    <table><thead><tr><th>番号</th><th>区分</th><th>発行日</th><th class="num">小計</th><th class="num">消費税</th><th class="num">源泉</th><th class="num">支払額</th><th>状態</th><th></th></tr></thead><tbody>
    \${invoices.map((i)=>'<tr><td>'+i.invoice_no+'</td><td>'+(i.direction==='receivable'?'請求':'支払')+'</td><td>'+i.issue_date+'</td><td class="num">'+yen(i.subtotal)+'</td><td class="num">'+yen(i.tax)+'</td><td class="num">'+(i.withholding?'▲'+yen(i.withholding):'—')+'</td><td class="num">'+yen(i.payable)+'</td><td><span class="pill">'+i.status+'</span></td><td>'+(i.url?'<a target="_blank" href="'+i.url+'">PDF表示</a>':'—')+'</td></tr>').join('') || '<tr><td colspan="9" class="muted">請求書がありません</td></tr>'}
    </tbody></table></section>
  <section><h2>契約書</h2>
    <table><thead><tr><th>種別</th><th>タイトル</th><th>状態</th><th>発効日</th><th></th></tr></thead><tbody>
    \${contracts.map((c)=>'<tr><td>'+c.kind+'</td><td>'+esc(c.title)+'</td><td><span class="pill">'+c.status+'</span></td><td>'+(c.effective_date||'—')+'</td><td>'+(c.url?'<a target="_blank" href="'+c.url+'">表示</a>':'—')+'</td></tr>').join('') || '<tr><td colspan="5" class="muted">契約書がありません</td></tr>'}
    </tbody></table></section>\`;
}
async function makeInvoice(direction) {
  try { const r = await api('/api/invoices', { method:'POST', body: JSON.stringify({ projectId:S.projectId, direction }) });
    toast('作成しました: ' + r.invoice_no); render(); } catch (e) { toast(e.message, true); }
}
async function makeContract() {
  try {
    const p = await api('/api/projects/'+S.projectId);
    const r = await api('/api/contracts', { method:'POST', body: JSON.stringify({
      kind:'master', fromOrgId:p.agency_org_id, toOrgId:p.media_org_id, projectId:S.projectId })});
    toast('契約書を作成しました: ' + r.title); render();
  } catch (e) { toast(e.message, true); }
}

async function viewReports() {
  const list = await api('/api/reports?projectId='+S.projectId+'&limit=30');
  return \`
  <section><h2>日次報告書</h2>
    <div class="row"><button onclick="makeReport()">昨日分を生成して配信</button></div>
    <table><thead><tr><th>日付</th><th>タイトル</th><th class="num">消化</th><th class="num">CV</th><th class="num">CPA</th><th class="num">アラート</th><th>配信</th><th></th></tr></thead><tbody>
    \${list.map((r)=>'<tr><td>'+r.date+'</td><td>'+esc(r.title)+'</td><td class="num">'+yen(r.summary.spend)+'</td><td class="num">'+(r.summary.conversions??0)+'</td><td class="num">'+(r.summary.cpa?yen(r.summary.cpa):'—')+'</td><td class="num">'+(r.summary.alerts??0)+'</td><td><span class="pill">'+r.delivery_status+'</span></td><td><a target="_blank" href="/api/reports/'+r.id+'?format=html">開く</a></td></tr>').join('') || '<tr><td colspan="8" class="muted">レポートがありません</td></tr>'}
    </tbody></table></section>\`;
}
async function makeReport() {
  try { const r = await api('/api/projects/'+S.projectId+'/reports/daily', { method:'POST', body:'{}' });
    toast('レポートを生成しました（配信: '+r.delivery.status+'）'); render(); } catch (e) { toast(e.message, true); }
}

async function viewJobs() {
  const [jobs, events] = await Promise.all([api('/api/jobs?limit=60'), api('/api/events?limit=40')]);
  return \`
  <section><h2>ジョブ</h2>
    <table><thead><tr><th>種別</th><th>状態</th><th class="num">試行</th><th>実行予定</th><th>エラー</th><th></th></tr></thead><tbody>
    \${jobs.map((j)=>'<tr><td>'+j.type+'</td><td><span class="pill '+(j.status==='succeeded'?'good':j.status==='failed'||j.status==='dead'?'bad':'')+'">'+j.status+'</span></td><td class="num">'+j.attempts+'/'+j.max_attempts+'</td><td class="muted">'+j.run_at.slice(0,16).replace('T',' ')+'</td><td class="muted">'+esc((j.last_error||'').slice(0,80))+'</td><td>'+(j.status==='dead'||j.status==='failed'?'<a href="#" onclick="retryJob(\\''+j.id+'\\');return false">再試行</a>':'')+'</td></tr>').join('')}
    </tbody></table></section>
  <section><h2>監査ログ</h2><pre>\${esc(events.map((e)=>e.created_at+'  '+e.actor+'  '+e.action+'  '+(e.subject_id||'')).join('\\n'))}</pre></section>\`;
}
async function retryJob(id) {
  try { await api('/api/jobs/'+id+'/retry', { method:'POST', body:'{}' }); toast('再試行を登録しました'); render(); }
  catch (e) { toast(e.message, true); }
}

function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.getElementById('project').addEventListener('change', (e) => { S.projectId = e.target.value; render(); });
document.getElementById('apiKey').value = localStorage.getItem('asp_key') || '';
boot();
</script></body></html>`;
}
