import { escapeHtml } from '../lib/text.ts';
import { ASPECT_SIZES } from './types.ts';
import type { AspectRatio } from '../domain/types.ts';

/**
 * 鍵未設定時に「実際に開けるプレビュー」を生成する。
 * ダミーバイト列ではなく閲覧可能な SVG を出すことで、構成・尺・カット割りの確認まではできる。
 */
const PALETTE = [
  ['#0f172a', '#1e293b', '#38bdf8'],
  ['#1a0b2e', '#2d1b4e', '#f472b6'],
  ['#052e2b', '#0b4f4a', '#34d399'],
  ['#2b1206', '#4a2410', '#fb923c'],
];

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < maxLines; i += perLine) {
    lines.push(text.slice(i, i + perLine));
  }
  if (lines.length === maxLines && text.length > perLine * maxLines) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, perLine - 1)}…`;
  }
  return lines;
}

export function storyboardSvg(opts: {
  prompt: string;
  aspectRatio: AspectRatio;
  label?: string;
  durationSec?: number;
  index?: number;
}): string {
  const { width, height } = ASPECT_SIZES[opts.aspectRatio];
  const colors = PALETTE[hash(opts.prompt) % PALETTE.length]!;
  const [bg, mid, accent] = colors as [string, string, string];
  const perLine = Math.floor(width / 34);
  const lines = wrap(opts.prompt, perLine, 6);
  const fontSize = Math.round(width / 30);
  const startY = Math.round(height * 0.55);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="60%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${bg}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <circle cx="${width * 0.78}" cy="${height * 0.22}" r="${width * 0.22}" fill="${accent}" opacity="0.18"/>
  <circle cx="${width * 0.2}" cy="${height * 0.34}" r="${width * 0.14}" fill="${accent}" opacity="0.1"/>
  <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.1)}" fill="#000" opacity="0.35"/>
  <text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.065)}" fill="${accent}"
        font-family="sans-serif" font-size="${Math.round(fontSize * 0.9)}" font-weight="700">
    ${escapeHtml(opts.label ?? 'STORYBOARD')}${opts.index !== undefined ? ` / CUT ${opts.index + 1}` : ''}${opts.durationSec ? ` / ${opts.durationSec}s` : ''}
  </text>
  <text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.45)}" fill="#ffffff"
        font-family="sans-serif" font-size="${Math.round(fontSize * 1.1)}" font-weight="700" opacity="0.85">
    ${escapeHtml(opts.aspectRatio)} ${width}x${height}
  </text>
  ${lines
    .map(
      (line, i) =>
        `<text x="${Math.round(width * 0.05)}" y="${startY + i * Math.round(fontSize * 1.5)}" fill="#e2e8f0" font-family="sans-serif" font-size="${fontSize}">${escapeHtml(line)}</text>`,
    )
    .join('\n  ')}
  <text x="${Math.round(width * 0.05)}" y="${height - Math.round(fontSize)}" fill="${accent}"
        font-family="monospace" font-size="${Math.round(fontSize * 0.8)}" opacity="0.8">
    PLACEHOLDER — 実プロバイダの鍵を設定すると本素材に差し替わります
  </text>
</svg>`;
}

/** 音声プレースホルダ（無音 WAV, 16bit/24kHz mono） */
export function silentWav(durationSec: number, sampleRate = 24000): Uint8Array {
  const samples = Math.max(1, Math.round(durationSec * sampleRate));
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buf);
}
