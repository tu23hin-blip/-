import { projects } from '../db/repositories/projects.ts';
import { config } from '../config/env.ts';
import { addDays, endOfMonth, jstDateString, jstHour } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';
import { enqueue } from './queue.ts';
import { reapStale } from './queue.ts';

const log = createLogger('scheduler');

/**
 * 定期実行。cron ライブラリは使わず、1分ごとに「今この時刻に実行すべきものがあるか」を見る方式。
 * dedupeKey に日付・時刻を含めているので、多重起動しても同じ仕事は1回しか実行されない。
 */

export type SchedulerHandle = { stop: () => void };

export function startScheduler(intervalMs = 60_000): SchedulerHandle {
  log.info('スケジューラ起動', { dailyReportHourJst: config.report.dailyHourJst });
  tick();
  const timer = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(timer) };
}

export function tick(now = new Date()): void {
  const hour = jstHour(now);
  const today = jstDateString(now);
  const yesterday = addDays(today, -1);
  const active = projects.active();

  // 毎時: 実績取り込み（当日分を更新）
  for (const project of active) {
    enqueue('meta.sync', { projectId: project.id, date: today }, {
      dedupeKey: `sync:${project.id}:${today}:${hour}`,
      priority: 6,
    });
  }

  // 06:00 JST: 前日確定値の取り込み → 最適化
  if (hour === 6) {
    for (const project of active) {
      enqueue('meta.sync', { projectId: project.id, date: yesterday }, {
        dedupeKey: `sync_final:${project.id}:${yesterday}`, priority: 2,
      });
      enqueue('meta.optimize', { projectId: project.id, date: yesterday }, {
        dedupeKey: `optimize:${project.id}:${yesterday}`, priority: 3,
        runAt: new Date(Date.now() + 60_000),
      });
    }
  }

  // 日次レポート（既定 09:00 JST）
  if (hour === config.report.dailyHourJst) {
    for (const project of active) {
      enqueue('report.daily', { projectId: project.id, date: yesterday }, {
        dedupeKey: `report:${project.id}:${yesterday}`, priority: 4,
      });
    }
    enqueue('report.agency', { date: yesterday }, { dedupeKey: `report_agency:${yesterday}`, priority: 5 });
  }

  // 週次: 月曜 10:00 に配信中クリエイティブの法務再監査
  if (hour === 10 && new Date(`${today}T00:00:00+09:00`).getUTCDay() === 1) {
    for (const project of active) {
      enqueue('legal.audit', { projectId: project.id }, { dedupeKey: `audit:${project.id}:${today}`, priority: 7 });
    }
  }

  // 月初 11:00: 前月分の請求書・支払通知書を作成
  if (hour === 11 && today.endsWith('-01')) {
    const prevMonthEnd = addDays(today, -1);
    const periodFrom = `${prevMonthEnd.slice(0, 7)}-01`;
    const periodTo = endOfMonth(prevMonthEnd);
    for (const project of active) {
      enqueue('invoice.monthly', { projectId: project.id, periodFrom, periodTo }, {
        dedupeKey: `invoice:${project.id}:${periodTo}`, priority: 4,
      });
    }
  }

  // 10分ごと: 通知の掃き出しと滞留ジョブの回収
  if (now.getUTCMinutes() % 10 === 0) {
    enqueue('notify.flush', {}, { dedupeKey: `notify:${today}:${now.getUTCHours()}:${now.getUTCMinutes()}`, priority: 8 });
    reapStale();
  }
}
