// ダミーデータの投入（画面の動作確認用）。数字はすべて架空です。
//   npm run db:seed            … DBが空のときだけ投入
//   npm run db:seed -- --force … DBを作り直して投入
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, localDate, addDays } from '../config.js';
import { openDb, createRecorder } from './index.js';

// 再現性のある乱数
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const SEED_DIVISIONS = [
  { slug: 'x-note', name: 'X＋note事業部', skill_name: 'x-note', status: 'active', weekly_goal: { metric: 'impressions', target: 25000 } },
  { slug: 'short-video', name: 'ショート動画事業部', skill_name: 'short-video', status: 'active', weekly_goal: { metric: 'impressions', target: 60000 } },
  { slug: 'site-llmo', name: '自サイト（LLMO）事業部', skill_name: 'site-llmo', status: 'paused', weekly_goal: { metric: 'clicks', target: 300 } },
];

const SAMPLE_POSTS = [
  ['AI副業の見極め', '「AIで月◯万」系の商材、見るポイントは3つだけ。①実績の根拠（スクショではなく再現手順）②返金条件 ③サポートの中身。この3つが曖昧なら買わなくていい。私は②で見送ることが一番多いです。\n※AI生成'],
  ['広告運用の小ネタ', 'CTRが1.2%→2.0%に上がったとき、変えたのは画像ではなく1行目の文言でした。「〜な方へ」より「〜で困っていませんか？」の方が、うちの案件では反応が良かった。必ずA/Bで確かめてから全体に反映してます。\n※AI生成'],
  ['AIツールの実務での使い方', '議事録をAIに要約させるとき、最初に「決定事項／保留／担当者と期限」の3見出しを指定するだけで、手直しの時間が半分くらいになりました。要約の精度より、型を先に決める方が効きます。\n※AI生成'],
];

function writeSeedFile(rel, content) {
  const abs = path.join(config.outputsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return path.relative(config.root, abs);
}

export function seed(db, { today = localDate(), days = 30 } = {}) {
  const rec = createRecorder(db);
  const rand = rng(20261105);
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const H = 3600 * 1000;
  const D = 24 * H;

  for (const d of SEED_DIVISIONS) rec.ensure_division(d);
  const div = Object.fromEntries(SEED_DIVISIONS.map((d) => [d.slug, rec.resolveDivision(d.slug).id]));

  // ---- metrics（過去30日。わざと空欄の日も作る） ----
  let followers = { 'x-note': 820, 'short-video': 1500, 'site-llmo': null };
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const t = (days - i) / days; // 0→1 で伸びる
    const skip = (p) => rand() < p; // 記録がない日
    // X＋note
    if (!skip(0.07)) {
      const imp = Math.round(1800 + 2200 * t + rand() * 900);
      rec.record_metric({ date, division: div['x-note'], name: 'impressions', value: imp });
      rec.record_metric({ date, division: div['x-note'], name: 'clicks', value: Math.round(imp * (0.015 + rand() * 0.012)) });
      followers['x-note'] += Math.round(3 + rand() * 9);
      rec.record_metric({ date, division: div['x-note'], name: 'followers', value: followers['x-note'] });
      rec.record_metric({ date, division: div['x-note'], name: 'posts', value: 2 + Math.round(rand()) });
      rec.record_metric({ date, division: div['x-note'], name: 'work_minutes', value: 20 + Math.round(rand() * 25) });
    }
    if (!skip(0.1)) rec.record_metric({ date, division: div['x-note'], name: 'revenue_jpy', value: rand() < 0.45 ? 0 : 500 * (1 + Math.floor(rand() * 4)) });
    rec.record_metric({ date, division: div['x-note'], name: 'api_cost_jpy', value: Math.round(25 + rand() * 40) });
    // ショート動画（後半だけ動いている想定）
    if (i < 18 && !skip(0.1)) {
      const imp = Math.round(4000 + 9000 * t + rand() * 4000);
      rec.record_metric({ date, division: div['short-video'], name: 'impressions', value: imp });
      rec.record_metric({ date, division: div['short-video'], name: 'clicks', value: Math.round(imp * (0.004 + rand() * 0.004)) });
      followers['short-video'] += Math.round(5 + rand() * 20);
      rec.record_metric({ date, division: div['short-video'], name: 'followers', value: followers['short-video'] });
      rec.record_metric({ date, division: div['short-video'], name: 'posts', value: 1 });
      rec.record_metric({ date, division: div['short-video'], name: 'work_minutes', value: 30 + Math.round(rand() * 30) });
      rec.record_metric({ date, division: div['short-video'], name: 'api_cost_jpy', value: Math.round(40 + rand() * 60) });
      if (rand() < 0.3) rec.record_metric({ date, division: div['short-video'], name: 'revenue_jpy', value: Math.round(100 + rand() * 600) });
    }
    // 自サイト（週2回くらいしか計測していない想定）
    if (rand() < 0.3) {
      rec.record_metric({ date, division: div['site-llmo'], name: 'impressions', value: Math.round(300 + rand() * 500) });
      rec.record_metric({ date, division: div['site-llmo'], name: 'clicks', value: Math.round(20 + rand() * 40) });
      rec.record_metric({ date, division: div['site-llmo'], name: 'revenue_jpy', value: Math.round(rand() * 1500) });
    }
  }

  // ---- 過去のタスク・成果物・イベント（X＋note） ----
  const insTask = db.prepare(`INSERT INTO tasks (division_id, title, detail, status, started_at, finished_at, error, created_at) VALUES (?,?,?,?,?,?,?,?)`);
  const insEvent = db.prepare('INSERT INTO events (division_id, task_id, type, message, created_at) VALUES (?,?,?,?,?)');
  const insOutput = db.prepare(`INSERT INTO outputs (task_id, division_id, kind, file_path, preview_text, approval, published_url, created_at, title, meta)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  for (let i = 7; i >= 1; i--) {
    const date = addDays(today, -i);
    const start = i * D + 2 * H;
    const t = insTask.run(div['x-note'], `X投稿案3本（${date}）`, null, 'done', iso(start), iso(start - 4 * 60000), null, iso(start));
    const taskId = Number(t.lastInsertRowid);
    insEvent.run(div['x-note'], taskId, 'start', '開始: X投稿案3本', iso(start));
    insEvent.run(div['x-note'], taskId, 'progress', 'Skill x-note を claude -p で実行中', iso(start - 30000));
    SAMPLE_POSTS.forEach(([theme, body], k) => {
      const file = writeSeedFile(`seed/x-note/${date}/x_post_${k + 1}.md`, body);
      const approval = k === 2 && i % 3 === 0 ? 'rejected' : 'approved';
      const url = approval === 'approved' && k < 2 ? `https://x.com/example/status/seed-${i}-${k}` : null;
      const o = insOutput.run(taskId, div['x-note'], 'x_post', file, body.slice(0, 120), approval, url, iso(start - 3 * 60000),
        `${theme} #${k + 1}`, JSON.stringify({ theme, dummy: true }));
      if (url) {
        rec.record_metric({ date, division: div['x-note'], name: 'impressions', value: Math.round(400 + rand() * 2500), output_id: Number(o.lastInsertRowid) });
      }
    });
    insEvent.run(div['x-note'], taskId, 'finish', '完了（承認待ち 3 件）', iso(start - 4 * 60000));
    insEvent.run(div['x-note'], taskId, 'approval', '承認: 3件中 2〜3件を承認', iso(start - 6 * H));
  }

  // 今日: 承認待ち3件のタスク + 実行中のタスク
  {
    const start = 3 * H;
    const t = insTask.run(div['x-note'], `X投稿案3本（${today}）`, null, 'awaiting_approval', iso(start), iso(start - 5 * 60000), null, iso(start));
    const taskId = Number(t.lastInsertRowid);
    insEvent.run(div['x-note'], taskId, 'start', '開始: X投稿案3本', iso(start));
    insEvent.run(div['x-note'], taskId, 'progress', 'テーマを選定: 広告運用の小ネタ', iso(start - 60000));
    SAMPLE_POSTS.forEach(([theme, body], k) => {
      const file = writeSeedFile(`seed/x-note/${today}/x_post_${k + 1}.md`, body);
      insOutput.run(taskId, div['x-note'], 'x_post', file, body.slice(0, 120), 'pending', null, iso(start - 4 * 60000),
        `${theme} #${k + 1}`, JSON.stringify({ theme, dummy: true }));
      insEvent.run(div['x-note'], taskId, 'progress', `成果物を保存（x_post・承認待ち）: ${theme} #${k + 1}`, iso(start - 4 * 60000));
    });
    insEvent.run(div['x-note'], taskId, 'finish', '完了（承認待ち 3 件）', iso(start - 5 * 60000));

    const r = insTask.run(div['x-note'], 'note記事の下書き（週次）', null, 'running', iso(4 * 60000), null, null, iso(4 * 60000));
    const rid = Number(r.lastInsertRowid);
    insEvent.run(div['x-note'], rid, 'start', '開始: note記事の下書き（週次）', iso(4 * 60000));
    insEvent.run(div['x-note'], rid, 'progress', '先週反応が良かったテーマを確認中', iso(2 * 60000));
  }

  // ショート動画: 昨日は成功、今日は失敗
  {
    const y = insTask.run(div['short-video'], '台本1本（昨日）', null, 'done', iso(D + H), iso(D + H - 6 * 60000), null, iso(D + H));
    const yid = Number(y.lastInsertRowid);
    const file = writeSeedFile(`seed/short-video/${addDays(today, -1)}/script_1.md`,
      '# 台本：議事録AIの型\n\n[0-3秒] テロップ「議事録、AIに丸投げしてない？」\n[3-20秒] 3つの見出しを先に決める\n[20-45秒] 実例\n[45-58秒] まとめ\n\n素材: 画面録画（自分のPC）、フリー素材のBGM\n※AI生成');
    insOutput.run(yid, div['short-video'], 'script', file, '議事録、AIに丸投げしてない？ 3つの見出しを先に決める…', 'approved', null, iso(D + H - 5 * 60000),
      '議事録AIの型', JSON.stringify({ dummy: true }));
    insEvent.run(div['short-video'], yid, 'start', '開始: 台本1本', iso(D + H));
    insEvent.run(div['short-video'], yid, 'finish', '完了', iso(D + H - 6 * 60000));
    const f = insTask.run(div['short-video'], '台本1本（今日）', null, 'failed', iso(2 * H), iso(2 * H - 60000), 'claude -p がタイムアウトしました（ダミー）', iso(2 * H));
    const fid = Number(f.lastInsertRowid);
    insEvent.run(div['short-video'], fid, 'start', '開始: 台本1本', iso(2 * H));
    insEvent.run(div['short-video'], fid, 'fail', '失敗: claude -p がタイムアウトしました（ダミー）', iso(2 * H - 60000));
  }

  // 自サイト: 一時停止中
  insEvent.run(div['site-llmo'], null, 'progress', '一時停止: 立ち上げ準備中', iso(5 * D));

  // 週次レポート（ダミー）
  {
    const file = writeSeedFile(`seed/reports/${addDays(today, -3)}-weekly.md`,
      `# 週次レポート（ダミー）\n\nこれは画面確認用のダミーレポートです。数字は架空です。\n\n## X＋note事業部\n- インプレッション: 前週比 +12%\n- 伸びた投稿: 広告運用の小ネタ\n- 来週の方針案: 1) 具体例を数字で始める 2) 平日朝に寄せる 3) noteへの導線を1本だけ\n`);
    insOutput.run(null, div['x-note'], 'report', file, '週次レポート（ダミー）', 'approved', null, iso(3 * D), `週次レポート ${addDays(today, -3)}（ダミー）`,
      JSON.stringify({ type: 'weekly_report', dummy: true }));
  }

  rec.set_meta('seeded', '1');
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const force = process.argv.includes('--force');
  if (force) {
    for (const s of ['', '-wal', '-shm', '-journal']) if (fs.existsSync(config.dbPath + s)) fs.rmSync(config.dbPath + s);
    fs.rmSync(path.join(config.outputsDir, 'seed'), { recursive: true, force: true });
  }
  const db = openDb();
  const n = db.prepare('SELECT COUNT(*) c FROM tasks').get().c + db.prepare('SELECT COUNT(*) c FROM metrics').get().c;
  if (n > 0) {
    console.error('DBにすでにデータがあります。作り直して投入する場合は --force を付けてください（既存データは消えます）。');
    process.exit(1);
  }
  seed(db);
  console.log(`ダミーデータを投入しました: ${config.dbPath}`);
  console.log('※数字はすべて架空です。本番運用の前に npm run db:reset -- --yes で消してください。');
}
