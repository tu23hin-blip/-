// テスト用: 一時フォルダに DB・outputs・ロックを置き、claude を偽物に差し替える。
// 静的 import より前に環境変数を決める必要があるので、各テストは setupEnv() の後に動的 import する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function setupEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-company-test-'));
  Object.assign(process.env, {
    DB_PATH: path.join(dir, 'test.db'),
    OUTPUTS_DIR: path.join(dir, 'outputs'),
    LOCK_DIR: path.join(dir, 'locks'),
    CLAUDE_BIN: fileURLToPath(new URL('./fake-claude.js', import.meta.url)),
    FAKE_CLAUDE_LOG: path.join(dir, 'claude.log'),
    USD_JPY_RATE: '150',
    DAILY_API_COST_LIMIT_JPY: '',
    TZ: 'Asia/Tokyo',
    ...extra,
  });
  return dir;
}

export function claudeCalls() {
  const f = process.env.FAKE_CLAUDE_LOG;
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
