// claude -p の呼び出し。プロンプトは標準入力で渡し、JSON出力（結果テキストとコスト）を受け取る。
// 書き込み・コマンド実行・Web取得系のツールは禁止し、読むことだけ許可する（公開・投稿を物理的にできなくする）。
import { spawn } from 'node:child_process';
import { config } from './config.js';

/** 実行中の claude プロセス（停止時にまとめて止める） */
export const activeChildren = new Set();

export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Skill'];
export const BLOCKED_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];

export function runClaude({ prompt, agent = null, timeoutMs = config.claudeTimeoutMs, onSpawn } = {}) {
  const args = ['-p', '--output-format', 'json',
    '--allowedTools', ...READ_ONLY_TOOLS,
    '--disallowedTools', ...BLOCKED_TOOLS];
  if (agent) args.push('--agent', agent);
  if (config.claudeModel) args.push('--model', config.claudeModel);

  return new Promise((resolve, reject) => {
    const child = spawn(config.claudeBin, args, { cwd: config.root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    onSpawn?.(child);
    activeChildren.add(child);
    child.on('exit', () => activeChildren.delete(child));
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`claude -p がタイムアウトしました（${Math.round(timeoutMs / 60000)}分）`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude を起動できません（${config.claudeBin}）: ${e.message}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal && !out.trim()) return reject(new Error(`claude -p が停止されました（${signal}）`));
      let json = null;
      try { json = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || ''); } catch { /* 下で扱う */ }
      if (!json) return reject(new Error(`claude -p の出力を読めません（exit ${code}）: ${(err || out).slice(0, 500)}`));
      const costUsd = typeof json.total_cost_usd === 'number' ? json.total_cost_usd : null;
      if (json.is_error || code !== 0) {
        const e = new Error(`claude -p がエラー終了: ${String(json.result || json.subtype || err).slice(0, 500)}`);
        e.costUsd = costUsd;
        return reject(e);
      }
      resolve({ text: String(json.result ?? ''), costUsd, sessionId: json.session_id ?? null, numTurns: json.num_turns ?? null });
    });
    child.stdin.end(prompt);
  });
}

/** テキストから最後の ```json ブロック（なければ全体）を JSON として取り出す */
export function extractJson(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [text];
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* 次へ */ }
  }
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* 下へ */ }
  }
  throw new Error('AIの出力から JSON を読み取れませんでした');
}
