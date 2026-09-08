import { connect as tlsConnect } from 'node:tls';
import { config } from '../config/env.ts';
import { reports, notifications } from '../db/repositories/system.ts';
import { projects } from '../db/repositories/projects.ts';
import { orgs } from '../db/repositories/orgs.ts';
import { request } from '../lib/http.ts';
import { createLogger } from '../lib/logger.ts';
import { publicUrl } from '../providers/storage/local.ts';
import type { Report } from '../domain/types.ts';

const log = createLogger('report:delivery');

/**
 * レポート配信。宛先チャネルは REPORT_DELIVERY で切り替える。
 * どの経路でも失敗はレポートの delivery_status に必ず記録する（送れたつもりを作らない）。
 */

export type DeliveryChannel = 'store' | 'slack' | 'webhook' | 'email';

export async function deliverReport(reportId: string, channel?: DeliveryChannel): Promise<{ status: string; detail?: string }> {
  const report = reports.require(reportId);
  const target = channel ?? (config.report.delivery as DeliveryChannel);

  try {
    switch (target) {
      case 'slack':
        await sendSlack(report);
        break;
      case 'webhook':
        await sendWebhook(report);
        break;
      case 'email':
        await sendEmail(report);
        break;
      case 'store':
      default:
        break;
    }
    reports.markDelivered(reportId, target === 'store' ? 'stored' : 'sent');
    log.info('レポートを配信', { reportId, channel: target });
    return { status: target === 'store' ? 'stored' : 'sent' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    reports.markDelivered(reportId, 'failed');
    notifications.create({
      project_id: report.project_id,
      level: 'warn',
      title: 'レポート配信に失敗しました',
      body: `${report.title}\n${detail}`,
    });
    log.error('レポート配信に失敗', { reportId, channel: target, error: detail });
    return { status: 'failed', detail };
  }
}

function summaryLines(report: Report): string[] {
  const summary = JSON.parse(report.summary || '{}') as Record<string, number>;
  const yen = (v: number | undefined) => (v === undefined ? '—' : `¥${Math.round(v).toLocaleString('ja-JP')}`);
  return [
    `消化: ${yen(summary['spend'])}`,
    `CV: ${summary['conversions'] ?? 0}件`,
    `CPA: ${summary['cpa'] ? yen(summary['cpa']) : '—'}`,
    `ROAS: ${summary['roas'] ?? '—'}`,
    `アラート: ${summary['alerts'] ?? 0}件`,
  ];
}

async function sendSlack(report: Report): Promise<void> {
  if (!config.report.slackWebhookUrl) throw new Error('SLACK_WEBHOOK_URL が未設定です');
  const project = report.project_id ? projects.find(report.project_id) : null;
  const summary = JSON.parse(report.summary || '{}') as Record<string, number>;
  const url = report.storage_path ? publicUrl(report.storage_path) : `${config.baseUrl}/api/reports/${report.id}`;

  await request(config.report.slackWebhookUrl, {
    method: 'POST',
    body: {
      text: report.title,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: report.title, emoji: true } },
        {
          type: 'section',
          fields: summaryLines(report).map((line) => ({ type: 'mrkdwn', text: `*${line.split(':')[0]}*\n${line.split(':').slice(1).join(':').trim()}` })),
        },
        ...(summary['alerts']
          ? [{ type: 'section', text: { type: 'mrkdwn', text: `:warning: 未解消のアラートが *${summary['alerts']}件* あります` } }]
          : []),
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'レポートを開く' }, url }],
        },
        ...(project ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `案件: ${project.name}` }] }] : []),
      ],
    },
  });
}

async function sendWebhook(report: Report): Promise<void> {
  if (!config.report.webhookUrl) throw new Error('REPORT_WEBHOOK_URL が未設定です');
  await request(config.report.webhookUrl, {
    method: 'POST',
    body: {
      id: report.id,
      projectId: report.project_id,
      type: report.type,
      date: report.date,
      title: report.title,
      summary: JSON.parse(report.summary || '{}'),
      markdown: report.markdown,
      url: report.storage_path ? publicUrl(report.storage_path) : null,
    },
  });
}

/**
 * 依存ライブラリなしの最小 SMTP クライアント（SMTPS / AUTH LOGIN）。
 * SMTP_URL 例: smtps://user:pass@smtp.example.com:465
 */
async function sendEmail(report: Report): Promise<void> {
  if (!config.report.smtpUrl) throw new Error('SMTP_URL が未設定です');
  const project = report.project_id ? projects.find(report.project_id) : null;
  const to = project ? recipientFor(project.client_org_id) : config.report.from;
  if (!to) throw new Error('宛先メールアドレスを解決できません');

  const url = new URL(config.report.smtpUrl);
  const host = url.hostname;
  const port = Number(url.port || 465);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);

  const boundary = `b${Date.now().toString(36)}`;
  const message = [
    `From: ${config.report.from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(report.title, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(report.markdown ?? report.title, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(report.html ?? `<pre>${report.markdown ?? ''}</pre>`, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  await smtpSend({ host, port, user, pass, from: config.report.from, to, message });
}

function recipientFor(orgId: string): string | null {
  return orgs.find(orgId)?.contact_email ?? null;
}

type SmtpOptions = {
  host: string; port: number; user: string; pass: string;
  from: string; to: string; message: string;
};

function smtpSend(opts: SmtpOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: opts.host, port: opts.port, servername: opts.host }, () => {
      /* 接続後は onData のステートマシンで進める */
    });
    socket.setEncoding('utf8');
    socket.setTimeout(30_000, () => {
      socket.destroy();
      reject(new Error('SMTP タイムアウト'));
    });

    const script: { expect: number; send: string | null }[] = [
      { expect: 220, send: `EHLO ${opts.host}\r\n` },
      { expect: 250, send: 'AUTH LOGIN\r\n' },
      { expect: 334, send: `${Buffer.from(opts.user).toString('base64')}\r\n` },
      { expect: 334, send: `${Buffer.from(opts.pass).toString('base64')}\r\n` },
      { expect: 235, send: `MAIL FROM:<${opts.from}>\r\n` },
      { expect: 250, send: `RCPT TO:<${opts.to}>\r\n` },
      { expect: 250, send: 'DATA\r\n' },
      { expect: 354, send: `${opts.message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n` },
      { expect: 250, send: 'QUIT\r\n' },
    ];
    let step = 0;
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      // 複数行応答は最終行が "NNN " 形式
      if (!/^\d{3} [^\n]*\r?\n$/m.test(buffer.split(/\r?\n/).filter(Boolean).slice(-1)[0] + '\n')) {
        if (!/\r?\n$/.test(buffer)) return;
      }
      const code = Number(buffer.trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 3));
      const current = script[step];
      if (!current) return;
      if (code !== current.expect) {
        socket.destroy();
        reject(new Error(`SMTP エラー (step ${step}): 期待 ${current.expect} / 実際 ${code} — ${buffer.trim().slice(0, 200)}`));
        return;
      }
      buffer = '';
      step++;
      if (current.send) socket.write(current.send);
      if (step >= script.length) {
        socket.end();
        resolve();
      }
    });

    socket.on('error', reject);
    socket.on('end', () => {
      if (step >= script.length - 1) resolve();
    });
  });
}
