import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { orders, projects } from './db/repositories/projects.ts';
import { deliverables } from './db/repositories/production.ts';
import { metaObjects } from './db/repositories/meta.ts';
import { settings } from './db/repositories/system.ts';
import { jobs } from './queue/queue.ts';
import { getHandler } from './queue/handlers.ts';
import { claim, succeed, fail } from './queue/queue.ts';
import { autoAccept } from './domain/workflow.ts';
import { syncProject, backfill } from './meta/sync.ts';
import { optimizeProject } from './meta/optimizer.ts';
import { generateDailyReport } from './reports/daily.ts';
import { check } from './legal/checker.ts';
import { buildInvoice, issueInvoice } from './legal/invoices.ts';
import { generateContract } from './legal/contracts.ts';
import { addDays, jstDateString } from './lib/date.ts';
import { providerStatus } from './providers/registry.ts';
import { seedLegalRules } from './legal/seed-rules.ts';
import type { Brief } from './domain/types.ts';

/**
 * 運用CLI。ワーカーを立てずに個々の処理を手で流せるようにしてある。
 * demo コマンドは「発注 → 制作 → 法務 → 納品 → 入稿 → 運用 → 最適化 → レポート → 請求」を
 * 一気通貫で実行し、この基盤が主張している自走ループを実際に確認できる。
 */

const out = (...args: unknown[]) => process.stdout.write(args.map(String).join(' ') + '\n');

/** キューに溜まったジョブを空になるまで同期的に処理する */
async function drain(maxJobs = 60): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = claim('cli');
    if (!job) break;
    const handler = getHandler(job.type);
    if (!handler) {
      fail(job.id, `未登録: ${job.type}`);
      continue;
    }
    try {
      const result = await handler(JSON.parse(job.payload || '{}'));
      succeed(job.id, result);
      out(`  ✓ ${job.type}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail(job.id, message);
      out(`  ✖ ${job.type}: ${message.split('\n')[0]}`);
    }
    processed++;
  }
  return processed;
}

const SAMPLE_BRIEF: Brief = {
  product: 'モイストリペアセラム',
  target: '30〜40代女性・夕方の乾燥が気になる層',
  painPoints: ['夕方になると肌がつっぱる', '何を選べばいいか分からない', '高価な化粧品は続かない'],
  usp: ['高保湿成分を独自比率で配合', '無香料・無着色・パラベンフリー', '初回限定価格で試せる'],
  offer: '初回限定 2,980円（送料無料）',
  tone: '落ち着いた信頼感。過度に煽らない',
  durationSec: 20,
  aspectRatios: ['9:16'],
  variations: 2,
  narration: true,
  subtitles: true,
  cta: '公式サイトで詳細を見る',
  landingUrl: 'https://example-cosme.jp/serum',
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  migrate();
  seedLegalRules();

  switch (command) {
    case 'seed': {
      const result = seed();
      out(`案件ID: ${result.projectId}`);
      out(`APIキー: ${result.apiKey}`);
      break;
    }

    case 'status': {
      out(JSON.stringify({ providers: providerStatus(), jobs: jobs.stats(), projects: projects.list().length }, null, 2));
      break;
    }

    case 'demo': {
      const seeded = seed();
      const projectId = args[0] ?? seeded.projectId ?? settings.get('seed.project_id');
      if (!projectId) throw new Error('案件がありません');
      const project = projects.require(projectId);
      out(`\n=== 案件: ${project.name} ===\n`);

      out('[1] 動画広告を発注');
      const videoOrder = orders.create({
        project_id: projectId,
        type: 'video_ad',
        title: 'デモ｜縦型動画 2本',
        brief: JSON.stringify(SAMPLE_BRIEF),
        quantity: 2,
        media_amount: 120_000,
        client_amount: 180_000,
        requested_by: 'cli',
      });
      autoAccept(videoOrder.id, 'cli');

      out('[2] 記事LPを発注');
      const articleOrder = orders.create({
        project_id: projectId,
        type: 'article_lp',
        title: 'デモ｜記事LP 1本',
        brief: JSON.stringify({ ...SAMPLE_BRIEF, variations: 1, wordCount: 1800 }),
        quantity: 1,
        media_amount: 80_000,
        client_amount: 120_000,
        requested_by: 'cli',
      });
      autoAccept(articleOrder.id, 'cli');

      out('[3] 制作 → QC → 法務 → 承認 → 納品 → Meta入稿 を実行');
      let rounds = 0;
      while ((await drain()) > 0 && rounds++ < 12) { /* 連鎖するジョブが尽きるまで回す */ }

      for (const id of [videoOrder.id, articleOrder.id]) {
        const order = orders.require(id);
        const list = deliverables.byOrder(id);
        out(`  ${order.title}: ${order.status} / 納品物 ${list.length}件`);
        for (const d of list) out(`    - [${d.legal_status}] ${d.title} (${d.status})`);
      }

      out('\n[4] 配信を開始して14日分の実績を生成');
      const { activate } = await import('./meta/publisher.ts');
      await activate(projectId);
      await backfill(projectId, 14);
      const objects = metaObjects.list(projectId);
      out(`  Meta オブジェクト: ${objects.length}件（${objects.filter((o) => o.status === 'ACTIVE').length}件が配信中）`);

      out('\n[5] 自動最適化を実行');
      const optimize = await optimizeProject(projectId, jstDateString());
      out(`  提案 ${optimize.proposals}件 / 適用 ${optimize.applied}件 / 自動発注 ${optimize.createdOrders.length}件`);
      await drain();

      out('\n[6] 日次レポートを生成');
      const report = await generateDailyReport(projectId, addDays(jstDateString(), -1));
      out(`  ${report.title}`);
      out(`  ${report.storage_path}`);

      out('\n[7] 請求書・契約書を作成');
      const to = addDays(jstDateString(), -1);
      const invoice = buildInvoice({ projectId, direction: 'receivable', periodFrom: `${to.slice(0, 7)}-01`, periodTo: to });
      issueInvoice(invoice.id);
      out(`  請求書 ${invoice.invoice_no}: 税込 ${invoice.total.toLocaleString()}円 / 支払額 ${invoice.payable.toLocaleString()}円`);
      const contract = generateContract({
        kind: 'master', fromOrgId: project.agency_org_id, toOrgId: project.media_org_id, projectId,
      });
      out(`  契約書 ${contract.title}`);

      out('\n=== 完了 ===');
      out(`ダッシュボード: http://localhost:8787/  （APIキー: ${seeded.apiKey}）`);
      break;
    }

    case 'order': {
      const projectId = args[0] ?? settings.get('seed.project_id');
      const type = (args[1] ?? 'video_ad') as 'video_ad';
      if (!projectId) throw new Error('projectId を指定してください');
      const order = orders.create({
        project_id: projectId, type, title: `CLI発注 ${type}`,
        brief: JSON.stringify(SAMPLE_BRIEF), requested_by: 'cli',
      });
      autoAccept(order.id, 'cli');
      let rounds = 0;
      while ((await drain()) > 0 && rounds++ < 12) { /* 連鎖処理 */ }
      out(JSON.stringify(orders.require(order.id), null, 2));
      break;
    }

    case 'work': {
      const processed = await drain(Number(args[0] ?? 60));
      out(`処理件数: ${processed}`);
      break;
    }

    case 'sync': {
      const projectId = args[0] ?? settings.get('seed.project_id')!;
      out(JSON.stringify(await syncProject(projectId, args[1]), null, 2));
      break;
    }

    case 'optimize': {
      const projectId = args[0] ?? settings.get('seed.project_id')!;
      out(JSON.stringify(await optimizeProject(projectId, args[1]), null, 2));
      break;
    }

    case 'report': {
      const projectId = args[0] ?? settings.get('seed.project_id')!;
      const report = await generateDailyReport(projectId, args[1]);
      out(report.markdown ?? '');
      break;
    }

    case 'legal': {
      const text = args.join(' ');
      if (!text) throw new Error('チェックするテキストを渡してください');
      const result = await check({ text, category: 'cosmetics', subjectType: 'ad_copy', deep: false });
      out(`判定: ${result.status} / スコア: ${result.score}`);
      for (const f of result.findings) out(`  [${f.severity}] ${f.phrase} — ${f.reason}`);
      break;
    }

    case 'invoice': {
      const projectId = args[0] ?? settings.get('seed.project_id')!;
      const to = args[2] ?? addDays(jstDateString(), -1);
      const invoice = buildInvoice({
        projectId,
        direction: (args[1] as 'receivable') ?? 'receivable',
        periodFrom: `${to.slice(0, 7)}-01`,
        periodTo: to,
      });
      out(JSON.stringify({ ...invoice, html: undefined }, null, 2));
      break;
    }

    default:
      out(`使い方: npm run cli -- <command>

  seed                       サンプルデータを作成（APIキーを発行）
  demo                       発注→制作→法務→納品→入稿→運用→レポート→請求 を一気通貫で実行
  status                     プロバイダとキューの状態
  order <projectId> <type>   発注して制作パイプラインまで流す
  work [n]                   キューのジョブを n 件処理
  sync <projectId> [date]    Meta実績の取り込み
  optimize <projectId>       自動最適化の実行
  report <projectId> [date]  日次レポートの生成（Markdown出力）
  legal <text...>            表現の法務チェック
  invoice <projectId> [receivable|payable] [periodTo]
`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
