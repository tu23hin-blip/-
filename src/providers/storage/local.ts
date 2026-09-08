import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { config } from '../../config/env.ts';

/**
 * ローカルファイルストレージ。S3 等に差し替えられるよう最小インターフェースに絞る。
 * 保存パスは常に storageDir 配下に閉じる（パストラバーサル防止）。
 */
export type StoredFile = {
  path: string;       // storageDir からの相対パス
  absolutePath: string;
  bytes: number;
  checksum: string;
  mime: string;
};

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.pdf': 'application/pdf',
};

export function storageRoot(): string {
  return resolve(config.storageDir);
}

function safeJoin(relPath: string): string {
  const root = storageRoot();
  const abs = resolve(join(root, relPath));
  if (!abs.startsWith(root)) throw new Error(`ストレージ外への書き込みは禁止です: ${relPath}`);
  return abs;
}

export function guessMime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function save(relPath: string, data: Uint8Array | string): StoredFile {
  const abs = safeJoin(relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  writeFileSync(abs, buf);
  return {
    path: relPath,
    absolutePath: abs,
    bytes: buf.byteLength,
    checksum: createHash('sha256').update(buf).digest('hex'),
    mime: guessMime(relPath),
  };
}

export function read(relPath: string): Buffer {
  return readFileSync(safeJoin(relPath));
}

export function exists(relPath: string): boolean {
  return existsSync(safeJoin(relPath));
}

export function sizeOf(relPath: string): number {
  try {
    return statSync(safeJoin(relPath)).size;
  } catch {
    return 0;
  }
}

export function absolute(relPath: string): string {
  return safeJoin(relPath);
}

/** 案件/発注ごとの保存先を一意に決める */
export function pathFor(parts: { projectId: string; orderId?: string; kind: string; name: string }): string {
  const segs = ['projects', parts.projectId];
  if (parts.orderId) segs.push('orders', parts.orderId);
  segs.push(parts.kind, parts.name);
  return segs.join('/');
}

export function publicUrl(relPath: string): string {
  return `${config.baseUrl}/files/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}
