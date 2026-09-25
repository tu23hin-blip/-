// npm run render:samples … 7種類の図解テンプレートとアイキャッチ3種をサンプルデータで書き出す（デザイン確認用）
import fs from 'node:fs';
import path from 'node:path';
import { Renderer } from './render/renderer.js';
import { normalizeDiagram } from './render/diagramSpec.js';
import { iconSvg } from './render/icons.js';
import { DEMO_DIAGRAMS } from './providers/mockFixtures.js';

export const SAMPLE_DIAGRAMS = [
  ...DEMO_DIAGRAMS,
  {
    id: 'steps', type: 'steps', title: 'noteで有料記事を出す手順', subtitle: '最初の1本はこの順番で',
    items: [
      { label: '無料部分を書く', sub: '結果と理由まで見せる' },
      { label: '有料ラインを引く', sub: '予告文の直後に置く', highlight: true },
      { label: '価格を決める', sub: '最初は980円前後から' },
      { label: 'マガジンに追加する', sub: 'まとめ買いの導線になる' },
      { label: 'Xで告知する', sub: '誘導は1日1本まで' },
    ],
    footer: '',
  },
  {
    id: 'bar_chart', type: 'bar_chart', title: '図解1枚あたりの作業時間', subtitle: 'デモ用の架空の数値',
    items: { unit: '分', bars: [{ label: '手作業', value: 20 }, { label: '画像生成AI＋手直し', value: 12 }, { label: 'AI＋テンプレート', value: 3, highlight: true }] },
    footer: '※デモ用の架空の数値です',
  },
  {
    id: 'matrix', type: 'matrix', title: '自動化する作業の優先順位', subtitle: '右上から手をつける',
    items: {
      x_axis: ['手間が多い', '手間が少ない'], y_axis: ['効果が小さい', '効果が大きい'],
      points: [
        { label: 'ネタ探し', x: 0.78, y: 0.82, highlight: true }, { label: 'タイトル案', x: 0.86, y: 0.55 },
        { label: '本文の執筆', x: 0.22, y: 0.7 }, { label: '図解づくり', x: 0.55, y: 0.62 }, { label: 'ハッシュタグ', x: 0.8, y: 0.2 },
      ],
    },
    footer: '',
  },
  {
    id: 'flow7', type: 'flow', title: '7工程の最大ケース', subtitle: '要素7つ・20文字近いラベル',
    items: [
      { label: 'ジャンルを探す', sub: '週1回' }, { label: 'ネタを選ぶ', sub: 'スコアで判定' }, { label: '事実と出典を集める', sub: 'Web検索' },
      { label: '構成と有料ラインを決める', sub: '無料3〜5割', highlight: true }, { label: '本文を書く', sub: '図の位置も' },
      { label: '図解とアイキャッチを作る', sub: 'テンプレで描画' }, { label: '校閲して公開待ちへ', sub: '最大2回書き直し' },
    ],
    footer: '要素が多いときは2段になります',
  },
];

export const SAMPLE_EYECATCHES = [
  { layout: 'center_bold', main_copy: '図解の文字崩れ、0に', sub_copy: '中身はAI・描画はテンプレ', badge: '保存版', icon_keyword: '画像' },
  { layout: 'left_text_right_icon', main_copy: 'AIで図解を量産する', sub_copy: '崩れない日本語で作る手順', badge: '実験', icon_keyword: '図解' },
  { layout: 'before_after_split', main_copy: '1枚20分→3分', sub_copy: '図解づくりを分業にした結果', badge: 'デモ', icon_keyword: '時間' },
];

export async function renderSamples({ config, log = console.log }) {
  const outDir = path.join(config.paths.output, '_samples');
  fs.mkdirSync(outDir, { recursive: true });
  const renderer = await Renderer.launch({ templatesDir: config.paths.templates, chromiumPath: config.chromiumPath });
  const colors = { primary: '#6657df', secondary: '#2b2548', accent: '#f5a76a' };
  const files = [];
  try {
    for (const raw of SAMPLE_DIAGRAMS) {
      const { diagram, problems } = normalizeDiagram(raw);
      const file = path.join(outDir, `diagram-${raw.id}.png`);
      const { overflow } = await renderer.renderDiagram(diagram, { colors, brand: 'AI編集部', outPath: file });
      log(`✓ ${path.relative(config.paths.root, file)}${problems.length ? `（ルール違反: ${problems.join(' / ')}）` : ''}${overflow.length ? `（はみ出し: ${overflow.join(' / ')}）` : ''}`);
      files.push(file);
    }
    for (const [i, spec] of SAMPLE_EYECATCHES.entries()) {
      const file = path.join(outDir, `eyecatch-${i + 1}-${spec.layout}.png`);
      const overflow = await renderer.renderEyecatch(spec, { colors, brand: 'AI編集部', iconSvg: iconSvg(spec.icon_keyword), outPath: file });
      log(`✓ ${path.relative(config.paths.root, file)}${overflow.overflow.length ? `（はみ出し: ${overflow.overflow.join(' / ')}）` : ''}`);
      files.push(file);
    }
  } finally {
    await renderer.close();
  }
  return files;
}
