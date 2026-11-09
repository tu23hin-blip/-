// 材料づくりの実行。対象の部門は引数で受け取る（例: x-note）。
// クレジット切れ・キーの間違い・設定の不足はリトライしても直らないので retryable:false で返す。
import { buildVoice } from '../../integrations/x/voice.js';
import { researchThemes } from '../../integrations/x/research.js';

const JOBS = { voice: '口調の自動作成と実績の候補抽出', research: 'テーマのリサーチ（X）' };

export async function run({ jobId, rec, div, options = {}, helpers }) {
  if (!JOBS[jobId]) throw new Error(`材料づくりのジョブは ${Object.keys(JOBS).join(' / ')} です（${jobId}）`);
  const slug = (options.args || [])[0];
  if (!slug) {
    return { status: 'failed', retryable: false, reason: `対象の部門を指定してください（例: npm run ${jobId === 'voice' ? 'voice:build' : 'research:x'} -- x-note）` };
  }
  let target;
  try { target = rec.resolveDivision(slug); } catch {
    return { status: 'failed', retryable: false, reason: `部門 ${slug} が登録されていません` };
  }
  const taskId = rec.start_task({ division: div.id, title: `${JOBS[jobId]}: ${target.name}`, detail: { job: jobId, division: slug } });
  // claude -p のコストも材料づくりのAPIコストとして記録する
  const runClaude = async (o) => {
    const r = await helpers.runClaude(o);
    helpers.recordCost(rec, { division: div.id, taskId, costUsd: r.costUsd });
    return r;
  };
  const common = { rec, slug, runClaude, extractJson: helpers.extractJson, fetchImpl: options.fetchImpl, taskId, costDivisionId: div.id };
  try {
    const r = jobId === 'voice' ? await buildVoice({ ...common, force: !!options.force }) : await researchThemes(common);
    if (r.status === 'skipped') {
      rec.log_event({ task_id: taskId, message: `スキップ: ${r.reason}` });
      rec.finish_task(taskId, { message: `スキップ（${r.reason}）` });
      return { status: 'done', taskId, result: r };
    }
    rec.finish_task(taskId);
    return { status: 'done', taskId, result: r };
  } catch (e) {
    if (e.costUsd != null) helpers.recordCost(rec, { division: div.id, taskId, costUsd: e.costUsd });
    const msg = `${target.name}: ${e.message}`;
    rec.fail_task(taskId, msg);
    return { status: 'failed', taskId, reason: msg, retryable: e.retryable !== false && !/research\.yaml|x-accounts\.yaml|\.env/.test(e.message) };
  }
}
