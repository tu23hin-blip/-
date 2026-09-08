import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config/env.ts';
import { ASPECT_SIZES } from '../providers/types.ts';
import { absolute, save } from '../providers/storage/local.ts';
import { escapeHtml } from '../lib/text.ts';
import { createLogger } from '../lib/logger.ts';
import type { AspectRatio } from '../domain/types.ts';

const exec = promisify(execFile);
const log = createLogger('edl');

/**
 * EDL（Edit Decision List）= 編集の設計図。
 * 「どの素材を、何秒目から何秒間、どんなテロップと音声で並べるか」だけを持つ純データ。
 *
 * ここを ffmpeg から独立させている理由:
 *  - 編集内容をレビュー・差分比較・再現できる（同じ EDL からは同じ動画が出る）
 *  - レンダラを差し替えられる（ffmpeg / 外部編集API / 人手）
 */

export type EdlClip = {
  index: number;
  role: string;
  /** 素材の絶対パス。プレースホルダの場合は null */
  sourcePath: string | null;
  sourceKind: 'video' | 'image';
  /** 素材の出所。ここが ai_generated / client_provided 以外になることは許さない。 */
  sourceOrigin: 'ai_generated' | 'client_provided';
  startSec: number;
  durationSec: number;
  onScreenText: string;
  narrationPath: string | null;
  narrationText: string;
  transition: 'cut' | 'fade' | 'slide';
};

export type Edl = {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  totalDurationSec: number;
  clips: EdlClip[];
  bgmPath: string | null;
  bgmVolume: number;
  /** 焼き込み字幕を使うか（Meta では音声オフ視聴が多数のため既定で有効） */
  burnSubtitles: boolean;
  safeAreaTopPct: number;
  safeAreaBottomPct: number;
};

export function buildEdl(input: {
  aspectRatio: AspectRatio;
  clips: Omit<EdlClip, 'startSec' | 'index'>[];
  bgmPath?: string | null;
  fps?: number;
  burnSubtitles?: boolean;
}): Edl {
  const size = ASPECT_SIZES[input.aspectRatio];
  let cursor = 0;
  const clips: EdlClip[] = input.clips.map((clip, index) => {
    const item: EdlClip = { ...clip, index, startSec: Math.round(cursor * 100) / 100 };
    cursor += clip.durationSec;
    return item;
  });

  return {
    aspectRatio: input.aspectRatio,
    width: size.width,
    height: size.height,
    fps: input.fps ?? 30,
    totalDurationSec: Math.round(cursor * 100) / 100,
    clips,
    bgmPath: input.bgmPath ?? null,
    bgmVolume: 0.12,
    burnSubtitles: input.burnSubtitles ?? true,
    // Meta のUI（プロフィール名・CTAボタン）に被らないセーフエリア
    safeAreaTopPct: 14,
    safeAreaBottomPct: 20,
  };
}

/** SRT 字幕を書き出す（焼き込みしない場合の入稿用にも使う） */
export function toSrt(edl: Edl): string {
  const fmt = (sec: number): string => {
    const ms = Math.round((sec % 1) * 1000);
    const total = Math.floor(sec);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
  };
  return edl.clips
    .filter((c) => c.onScreenText.trim())
    .map((c, i) => `${i + 1}\n${fmt(c.startSec)} --> ${fmt(c.startSec + c.durationSec)}\n${c.onScreenText}\n`)
    .join('\n');
}

/**
 * ffmpeg の filter_complex を組み立てる。
 * 縦型(9:16)を基準に、素材の比率が違っても「切らずに収める（pad）」方針。
 * 素材の一部が欠けると訴求要素（商品・文字）が消えるため、fit を優先している。
 */
export function toFfmpegCommand(edl: Edl, outputPath: string): { args: string[]; command: string } {
  const inputs: string[] = [];
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  let inputIndex = 0;

  for (const clip of edl.clips) {
    if (clip.sourcePath) {
      if (clip.sourceKind === 'image') {
        inputs.push('-loop', '1', '-t', String(clip.durationSec), '-i', clip.sourcePath);
      } else {
        inputs.push('-i', clip.sourcePath);
      }
    } else {
      // 素材未確定のカットは黒地に置き換えて尺だけ確保する
      inputs.push('-f', 'lavfi', '-t', String(clip.durationSec), '-i', `color=c=black:s=${edl.width}x${edl.height}:r=${edl.fps}`);
    }
    const vIn = `${inputIndex}:v`;
    const label = `v${clip.index}`;
    const chain = [
      `scale=${edl.width}:${edl.height}:force_original_aspect_ratio=decrease`,
      `pad=${edl.width}:${edl.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `setsar=1`,
      `fps=${edl.fps}`,
      `trim=duration=${clip.durationSec}`,
      `setpts=PTS-STARTPTS`,
    ];
    if (clip.transition === 'fade') {
      chain.push(`fade=t=in:st=0:d=0.3`, `fade=t=out:st=${Math.max(0, clip.durationSec - 0.3)}:d=0.3`);
    }
    filters.push(`[${vIn}]${chain.join(',')}[${label}]`);
    videoLabels.push(`[${label}]`);
    inputIndex++;
  }

  // ナレーション: クリップ開始位置に遅延して配置し、最後に合成
  for (const clip of edl.clips) {
    if (!clip.narrationPath) continue;
    inputs.push('-i', clip.narrationPath);
    const label = `a${clip.index}`;
    const delayMs = Math.round(clip.startSec * 1000);
    filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},apad[${label}]`);
    audioLabels.push(`[${label}]`);
    inputIndex++;
  }

  if (edl.bgmPath) {
    inputs.push('-stream_loop', '-1', '-i', edl.bgmPath);
    filters.push(`[${inputIndex}:a]volume=${edl.bgmVolume},atrim=duration=${edl.totalDurationSec}[bgm]`);
    audioLabels.push('[bgm]');
    inputIndex++;
  }

  filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vcat]`);

  let lastVideo = 'vcat';
  if (edl.burnSubtitles) {
    // テロップはセーフエリア内に、縁取り＋半透明帯で可読性を確保
    const y = Math.round(edl.height * (1 - edl.safeAreaBottomPct / 100)) - Math.round(edl.height * 0.06);
    const fontSize = Math.round(edl.width / 22);
    const draws = edl.clips
      .filter((c) => c.onScreenText.trim())
      .map((c) => {
        const text = c.onScreenText.replace(/[\\:']/g, '').replace(/,/g, '\\,');
        return `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=white:borderw=${Math.round(fontSize / 8)}:bordercolor=black@0.9:box=1:boxcolor=black@0.35:boxborderw=${Math.round(fontSize / 3)}:x=(w-text_w)/2:y=${y}:enable='between(t,${c.startSec},${c.startSec + c.durationSec})'`;
      });
    if (draws.length) {
      filters.push(`[vcat]${draws.join(',')}[vout]`);
      lastVideo = 'vout';
    }
  }

  const args = [...inputs, '-filter_complex'];
  let audioOut = '';
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
    audioOut = 'aout';
  }
  args.push(filters.join(';'));
  args.push('-map', `[${lastVideo}]`);
  if (audioOut) args.push('-map', `[${audioOut}]`);
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(edl.fps),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart',
    '-t', String(edl.totalDurationSec),
    '-y', outputPath,
  );

  const command = `${config.render.ffmpeg} ${args.map((a) => (/[\s;'"\[\]]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(' ')}`;
  return { args, command };
}

export type RenderResult = {
  rendered: boolean;
  outputPath: string | null;
  command: string;
  manifestPath: string;
  previewPath: string;
  reason?: string;
};

/**
 * レンダリング。ffmpeg があれば実際に書き出し、無ければ
 * 「EDL + 実行コマンド + HTMLプレビュー」を成果物として残す。
 * どちらの場合も後工程（QC・法務・入稿）は同じ形で進められる。
 */
export async function render(edl: Edl, outputRelPath: string): Promise<RenderResult> {
  const outAbs = absolute(outputRelPath);
  const { args, command } = toFfmpegCommand(edl, outAbs);

  const manifest = save(
    outputRelPath.replace(/\.[^.]+$/, '') + '.edl.json',
    JSON.stringify({ edl, command }, null, 2),
  );
  const preview = save(
    outputRelPath.replace(/\.[^.]+$/, '') + '.preview.html',
    previewHtml(edl, command),
  );
  save(outputRelPath.replace(/\.[^.]+$/, '') + '.srt', toSrt(edl));

  if (!config.render.enabled) {
    return { rendered: false, outputPath: null, command, manifestPath: manifest.path, previewPath: preview.path, reason: 'RENDER_ENABLED=false' };
  }
  if (edl.clips.some((c) => !c.sourcePath)) {
    return {
      rendered: false, outputPath: null, command,
      manifestPath: manifest.path, previewPath: preview.path,
      reason: '実素材が未確定のカットがあります（動画プロバイダの鍵未設定）',
    };
  }

  try {
    await exec(config.render.ffmpeg, args, { maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60_000 });
    log.info('レンダリング完了', { outputPath: outputRelPath, durationSec: edl.totalDurationSec });
    return { rendered: true, outputPath: outputRelPath, command, manifestPath: manifest.path, previewPath: preview.path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /ENOENT/.test(message);
    log.warn(missing ? 'ffmpeg が見つからないためドライラン扱いにします' : 'レンダリング失敗', { error: message.slice(0, 400) });
    return {
      rendered: false, outputPath: null, command,
      manifestPath: manifest.path, previewPath: preview.path,
      reason: missing ? 'ffmpeg 未インストール（コマンドは manifest に保存済み）' : message.slice(0, 500),
    };
  }
}

/** カット割り・テロップ・ナレーションを時系列で確認できる HTML プレビュー */
export function previewHtml(edl: Edl, command: string): string {
  const rows = edl.clips
    .map(
      (c) => `<tr>
    <td>${c.index + 1}</td>
    <td><span class="role">${escapeHtml(c.role)}</span></td>
    <td class="num">${c.startSec.toFixed(1)}s</td>
    <td class="num">${c.durationSec.toFixed(1)}s</td>
    <td><span class="origin ${c.sourceOrigin}">${c.sourceOrigin === 'ai_generated' ? 'AI生成' : '提供素材'}</span></td>
    <td>${c.sourcePath ? `<code>${escapeHtml(c.sourcePath.split('/').slice(-2).join('/'))}</code>` : '<em>未確定</em>'}</td>
    <td class="tel">${escapeHtml(c.onScreenText)}</td>
    <td class="nar">${escapeHtml(c.narrationText)}</td>
  </tr>`,
    )
    .join('');

  const timeline = edl.clips
    .map(
      (c) => `<div class="seg" style="flex:${c.durationSec}" title="${escapeHtml(c.onScreenText)}">
        <span>${c.index + 1}</span><small>${c.role}</small></div>`,
    )
    .join('');

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>動画プレビュー ${edl.aspectRatio}</title>
<style>
 :root{color-scheme:light dark}
 body{font-family:system-ui,"Hiragino Kaku Gothic ProN",sans-serif;margin:24px;background:#0f172a;color:#e2e8f0}
 h1{font-size:18px}
 .meta{display:flex;gap:20px;flex-wrap:wrap;margin:12px 0 20px;font-size:13px;color:#94a3b8}
 .meta b{color:#e2e8f0}
 .timeline{display:flex;gap:2px;height:52px;margin-bottom:20px;border-radius:6px;overflow:hidden}
 .seg{background:linear-gradient(160deg,#1e40af,#0ea5e9);display:flex;flex-direction:column;align-items:center;
      justify-content:center;font-size:11px;color:#fff;min-width:24px}
 .seg small{opacity:.75;font-size:9px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th,td{border-bottom:1px solid #1e293b;padding:8px 10px;text-align:left;vertical-align:top}
 th{color:#94a3b8;font-weight:600;font-size:12px}
 .num{text-align:right;font-variant-numeric:tabular-nums}
 .role{background:#1e293b;padding:2px 8px;border-radius:99px;font-size:11px}
 .origin{padding:2px 8px;border-radius:99px;font-size:11px;white-space:nowrap}
 .origin.ai_generated{background:#312e81;color:#c7d2fe}
 .origin.client_provided{background:#134e4a;color:#99f6e4}
 .tel{font-weight:600}
 .nar{color:#94a3b8;max-width:280px}
 code{background:#1e293b;padding:2px 5px;border-radius:4px;font-size:11px}
 pre{background:#020617;padding:14px;border-radius:8px;overflow-x:auto;font-size:11px;color:#7dd3fc;margin-top:24px}
</style></head><body>
<h1>動画広告プレビュー（EDL）</h1>
<div class="meta">
  <span>比率 <b>${edl.aspectRatio}</b></span>
  <span>解像度 <b>${edl.width}×${edl.height}</b></span>
  <span>尺 <b>${edl.totalDurationSec.toFixed(1)}秒</b></span>
  <span>カット数 <b>${edl.clips.length}</b></span>
  <span>字幕焼き込み <b>${edl.burnSubtitles ? 'あり' : 'なし'}</b></span>
  <span>AI生成 <b>${edl.clips.filter((c) => c.sourceOrigin === 'ai_generated').length}</b> / 提供素材 <b>${edl.clips.filter((c) => c.sourceOrigin === 'client_provided').length}</b></span>
</div>
<div class="timeline">${timeline}</div>
<table>
 <thead><tr><th>#</th><th>役割</th><th>開始</th><th>尺</th><th>素材出所</th><th>素材</th><th>テロップ</th><th>ナレーション</th></tr></thead>
 <tbody>${rows}</tbody>
</table>
<pre>${escapeHtml(command)}</pre>
</body></html>`;
}
