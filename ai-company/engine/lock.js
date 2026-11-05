// 同じ事業部の二重起動を防ぐロック（プロセスをまたいで有効）。
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const LOCK_DIR = config.lockDir;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** 取れたら release 関数、取れなければ null（実行中の pid を info に入れる） */
export function acquireLock(slug, info = {}) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const file = path.join(LOCK_DIR, `${slug}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      let released = false;
      return () => { if (!released) { released = true; try { fs.rmSync(file); } catch {} } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (holder?.pid && alive(holder.pid)) { info.holder = holder; return null; }
      try { fs.rmSync(file); } catch {} // 落ちたプロセスの残骸
    }
  }
  return null;
}
