#!/usr/bin/env node
// テスト用の claude 代わり。標準入力のプロンプトを見て、それらしい JSON を返す。
//   FAKE_CLAUDE_MODE=ok|fail|badjson|slow
import fs from 'node:fs';
const prompt = fs.readFileSync(0, 'utf8');
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), prompt }) + '\n');
const out = (o) => { process.stdout.write(JSON.stringify(o) + '\n'); };
if (mode === 'slow') await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_DELAY || 1500)));
if (mode === 'fail') { out({ type: 'result', is_error: true, result: 'API Error: overloaded', total_cost_usd: 0.01 }); process.exit(1); }
if (mode === 'badjson') { out({ type: 'result', is_error: false, result: 'JSONを出し忘れました', total_cost_usd: 0.02 }); process.exit(0); }

const post = (i) => `例: 議事録の要約で、最初に「決定事項／保留／担当と期限」の3つの見出しを指定すると、手直しが減ります。ポイントは要約の精度より型を先に決めること。今日の会議メモで試してみてください。テスト投稿${i}。見出しは3つまで、各項目は1行で書かせると読み返しやすくなります。※AI生成`;
let result;
if (process.argv.includes('--agent')) {
  result = { overall: 'テスト用の全体所感', divisions: [{ slug: 'x-note', summary: '先週は横ばい', good_posts: 'AIツール系', bad_posts: '広告系', policies: ['方針1', '方針2', '方針3'], goal_proposal: { metric: 'impressions', target: 30000, reason: 'テスト' } }] };
} else if (/ジョブ: weekly-note/.test(prompt)) {
  result = { theme: 'AIツールの実務での使い方: 議事録', theme_reason: 'テスト', outputs: [{ kind: 'note_article', title: '議事録AIの型', body: '# 議事録AIの型\n\n## 無料部分\n導入\n\n## 有料部分（ここから有料）\n手順\n\n本記事はAIを活用して作成し、筆者が確認・編集しています。' }], questions: [] };
} else if (/ジョブ: revise/.test(prompt)) {
  const kind = (prompt.match(/期待する成果物: (\w+)/) || [])[1] || 'x_post';
  result = { theme: '修正版', outputs: [{ kind, title: '修正版', body: post('修正') }], questions: [] };
} else if (/期待する成果物: script/.test(prompt)) {
  result = { theme: '議事録AIの型', outputs: [{ kind: 'script', title: '台本テスト', body: '# 台本\n[0-3秒] フック\n## テロップ\n- 1\n## 素材リスト\n- 画面録画\n※AIを活用して制作' }], questions: [] };
} else {
  result = { theme: 'AIツールの実務での使い方: 議事録の型', theme_reason: 'テスト', outputs: [1, 2, 3].map((i) => ({ kind: 'x_post', title: `議事録の型 #${i}`, body: post(i) })), questions: [] };
}
out({ type: 'result', is_error: false, result: '作業しました。\n```json\n' + JSON.stringify(result, null, 2) + '\n```', total_cost_usd: 0.05, num_turns: 3 });
