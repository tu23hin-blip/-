import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdl, toFfmpegCommand, toSrt } from '../src/pipelines/edl.ts';
import type { EdlClip } from '../src/pipelines/edl.ts';

const clip = (over: Partial<EdlClip> = {}): Omit<EdlClip, 'startSec' | 'index'> => ({
  role: 'hook',
  sourcePath: '/tmp/a.mp4',
  sourceKind: 'video',
  sourceOrigin: 'ai_generated',
  durationSec: 3,
  onScreenText: 'テロップ',
  narrationPath: null,
  narrationText: 'ナレーション',
  transition: 'cut',
  ...over,
});

describe('EDL（編集設計図）', () => {
  test('クリップの開始位置を尺から順に積み上げる', () => {
    const edl = buildEdl({ aspectRatio: '9:16', clips: [clip(), clip({ durationSec: 2 }), clip({ durationSec: 4.5 })] });
    assert.deepEqual(edl.clips.map((c) => c.startSec), [0, 3, 5]);
    assert.equal(edl.totalDurationSec, 9.5);
  });

  test('比率から解像度が決まる', () => {
    assert.deepEqual(
      [buildEdl({ aspectRatio: '9:16', clips: [clip()] }), buildEdl({ aspectRatio: '1:1', clips: [clip()] })]
        .map((e) => `${e.width}x${e.height}`),
      ['1080x1920', '1080x1080'],
    );
  });

  test('ffmpeg コマンドに入力・concat・字幕焼き込みが含まれる', () => {
    const edl = buildEdl({ aspectRatio: '9:16', clips: [clip(), clip({ onScreenText: '二枚目' })] });
    const { command, args } = toFfmpegCommand(edl, '/tmp/out.mp4');
    assert.ok(command.includes('concat=n=2'));
    assert.ok(command.includes('drawtext'));
    assert.ok(args.includes('/tmp/out.mp4'));
    assert.ok(command.includes('force_original_aspect_ratio=decrease'), '素材を切らず収める方針であること');
  });

  test('素材未確定のカットは黒地で尺を確保する', () => {
    const edl = buildEdl({ aspectRatio: '9:16', clips: [clip({ sourcePath: null })] });
    const { command } = toFfmpegCommand(edl, '/tmp/out.mp4');
    assert.ok(command.includes('color=c=black'));
  });

  test('ナレーションはクリップ開始位置に遅延配置され、ラウドネス正規化される', () => {
    const edl = buildEdl({
      aspectRatio: '9:16',
      clips: [clip(), clip({ narrationPath: '/tmp/n.mp3', durationSec: 2 })],
    });
    const { command } = toFfmpegCommand(edl, '/tmp/out.mp4');
    assert.ok(command.includes('adelay=3000|3000'));
    assert.ok(command.includes('loudnorm=I=-14'));
  });

  test('SRT のタイムコードが正しい', () => {
    const edl = buildEdl({ aspectRatio: '9:16', clips: [clip({ durationSec: 1.5, onScreenText: '一枚目' })] });
    const srt = toSrt(edl);
    assert.ok(srt.includes('00:00:00,000 --> 00:00:01,500'));
    assert.ok(srt.includes('一枚目'));
  });
});
