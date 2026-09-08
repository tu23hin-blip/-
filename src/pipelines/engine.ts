import { pipelineRuns } from '../db/repositories/production.ts';
import { nowIso } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';
import { parseJson } from '../db/sqlite.ts';
import type { PipelineStepRecord } from '../domain/types.ts';

const log = createLogger('pipeline');

export type StepContext<C> = {
  ctx: C;
  runId: string;
  orderId: string;
  log: ReturnType<typeof createLogger>;
  /** 直前までのステップ出力 */
  outputs: Record<string, unknown>;
};

export type Step<C> = {
  name: string;
  label: string;
  /** false を返すと skipped 扱いで次へ進む */
  when?: (c: StepContext<C>) => boolean;
  run: (c: StepContext<C>) => Promise<unknown>;
};

export type PipelineResult<C> = {
  runId: string;
  status: 'succeeded' | 'failed';
  ctx: C;
  outputs: Record<string, unknown>;
  steps: PipelineStepRecord[];
  error?: string;
};

/**
 * ステップごとに DB へ進捗を保存しながら実行する小さなパイプライン基盤。
 * 途中で落ちても「どこまで進んだか」「何が出力されたか」が残るので、
 * 人が引き継ぐことも、同じ run を再開することもできる。
 */
export async function runPipeline<C extends Record<string, unknown>>(
  orderId: string,
  pipelineName: string,
  steps: Step<C>[],
  initialCtx: C,
): Promise<PipelineResult<C>> {
  const records: PipelineStepRecord[] = steps.map((s) => ({
    name: s.name,
    label: s.label,
    status: 'pending',
  }));
  const run = pipelineRuns.start(orderId, pipelineName, records, initialCtx);
  const ctx = { ...initialCtx };
  const outputs: Record<string, unknown> = {};
  const plog = log.child(pipelineName);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const record = records[i]!;
    const sctx: StepContext<C> = { ctx, runId: run.id, orderId, log: plog.child(step.name), outputs };

    if (step.when && !step.when(sctx)) {
      record.status = 'skipped';
      record.finishedAt = nowIso();
      pipelineRuns.saveSteps(run.id, records, steps[i + 1]?.name ?? null, ctx);
      continue;
    }

    record.status = 'running';
    record.startedAt = nowIso();
    pipelineRuns.saveSteps(run.id, records, step.name, ctx);
    plog.info(`▶ ${step.label}`, { orderId, step: step.name });

    try {
      const output = await step.run(sctx);
      outputs[step.name] = output;
      record.status = 'succeeded';
      record.finishedAt = nowIso();
      record.output = summarize(output);
      pipelineRuns.saveSteps(run.id, records, steps[i + 1]?.name ?? null, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.status = 'failed';
      record.finishedAt = nowIso();
      record.error = message;
      pipelineRuns.saveSteps(run.id, records, step.name, ctx);
      pipelineRuns.finish(run.id, 'failed', `${step.name}: ${message}`);
      plog.error(`✖ ${step.label} 失敗`, { orderId, step: step.name, error: message });
      return { runId: run.id, status: 'failed', ctx, outputs, steps: records, error: `${step.label}: ${message}` };
    }
  }

  pipelineRuns.finish(run.id, 'succeeded');
  plog.info('パイプライン完了', { orderId, pipeline: pipelineName });
  return { runId: run.id, status: 'succeeded', ctx, outputs, steps: records };
}

/** ステップ出力は大きくなりがちなので、DB に残すのは要約だけにする */
function summarize(output: unknown): unknown {
  if (output === null || output === undefined) return null;
  if (Array.isArray(output)) return { type: 'array', length: output.length, sample: output.slice(0, 2) };
  if (typeof output === 'object') {
    const json = JSON.stringify(output);
    return json.length > 4000 ? { type: 'object', truncated: true, size: json.length } : output;
  }
  if (typeof output === 'string') return output.length > 1000 ? `${output.slice(0, 1000)}…` : output;
  return output;
}

export function stepsOf(runId: string): PipelineStepRecord[] {
  const run = pipelineRuns.find(runId);
  return run ? parseJson<PipelineStepRecord[]>(run.steps, []) : [];
}
