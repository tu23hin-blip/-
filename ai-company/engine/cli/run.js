// 事業部を1回手動で実行する。
//   npm run division -- x-note            （ジョブ省略時は最初のジョブ = daily）
//   npm run division -- x-note weekly-note
//   npm run division -- x-note revise     （修正依頼だけ処理）
//   npm run division -- x-note daily --force （一時停止中でも実行）
// 終了コード: 0=成功, 2=失敗, 3=スキップ（実行中・一時停止・コスト上限）
import { runJob } from '../runner.js';
import { activeChildren } from '../claude.js';
import { loadDivisionConfig, listDivisionConfigs } from '../registry.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
const [slug, jobArg] = args;
if (!slug) {
  console.error('使い方: npm run division -- <事業部slug> [ジョブ名]');
  console.error('事業部: ' + listDivisionConfigs().map((c) => `${c.slug}（${Object.keys(c.jobs || {}).join(', ') || 'run.js'}）`).join(' / '));
  process.exit(1);
}
const cfg = loadDivisionConfig(slug);
const jobId = jobArg || Object.keys(cfg.jobs || {})[0] || 'run';
// 停止シグナル: claude を止める → runJob が fail_task を記録してロックを外す
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.error(`\n${sig} を受け取りました。停止します…`);
    for (const c of activeChildren) c.kill('SIGTERM');
    setTimeout(() => process.exit(2), 5000).unref();
  });
}
console.log(`▶ ${cfg.name} / ${jobId} を実行します…`);
const t0 = Date.now();
const r = await runJob(slug, jobId, { force });
const sec = Math.round((Date.now() - t0) / 1000);
if (r.status === 'done') { console.log(`✓ 完了（${sec}秒）${r.taskId ? ` タスク #${r.taskId}` : ''}${r.taskStatus === 'awaiting_approval' ? ' → 承認待ちに出しました' : ''}`); process.exit(0); }
if (r.status === 'skipped') { console.log(`- スキップ: ${r.reason}`); process.exit(3); }
console.error(`✕ 失敗（${sec}秒）: ${r.reason || ''}`);
process.exit(2);
