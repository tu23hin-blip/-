import { recorder } from '@/lib/engine';
import { ok, fail } from '@/lib/api';
import { startTodaysRun } from '../../../../../engine/scheduler/today.js';

export const dynamic = 'force-dynamic';

// 「今日の分を回す」: 今日予定のジョブ（一時停止中・今日実行済みを除く）をバックグラウンドで開始する。
// 本物の claude / X API を使うので費用がかかる（画面側で確認してから呼ぶ）
export async function POST() {
  try {
    return ok(startTodaysRun(recorder()));
  } catch (e) { return fail(e, 500); }
}
