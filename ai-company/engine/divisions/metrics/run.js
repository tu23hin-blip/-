// job 'x': engine/integrations/x-accounts.yaml の各アカウントについて X の投稿の数字を取り込む。
// 1アカウントが失敗しても他のアカウントは続ける。失敗は日本語で events に fail を残す。
// クレジット切れ（402）とキーの間違い（401/403）はリトライしても直らないので、スケジューラにリトライさせない。
import { loadAccounts, importAccount } from '../../integrations/x/import.js';

export async function run({ jobId, rec, div, options = {} }) {
  if (jobId !== 'x') throw new Error(`数字の取り込みのジョブは x だけです（${jobId}）`);
  const force = options.force || process.argv.includes('--force');
  const accounts = loadAccounts();
  const taskId = rec.start_task({ division: div.id, title: 'X の投稿の数字を取り込み', detail: { job: jobId } });
  const failures = [];
  let anyDone = false, retryable = false;
  for (const account of accounts) {
    try {
      const r = await importAccount({ rec, account: { ...account, costDivision: div.id }, fetchImpl: options.fetchImpl, force, taskId });
      if (r.status === 'skipped') rec.log_event({ task_id: taskId, message: `スキップ: ${r.reason}` });
      else anyDone = true;
    } catch (e) {
      const msg = `${account.envPrefix}: ${e.message}`;
      failures.push(msg);
      if (e.retryable !== false) retryable = true;
      rec.log_event({ task_id: taskId, type: 'fail', message: `X の取り込みに失敗 — ${msg}` });
    }
  }
  if (failures.length) {
    rec.fail_task(taskId, failures.join(' ／ '));
    return { status: 'failed', taskId, reason: failures.join(' ／ '), retryable };
  }
  rec.finish_task(taskId, { message: anyDone ? '完了' : '完了（取り込むアカウントがありませんでした）' });
  return { status: 'done', taskId };
}
