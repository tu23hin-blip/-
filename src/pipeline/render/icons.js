// アイキャッチ用のアイコン（lucide）。AIが出したキーワードから選び、SVG文字列にする
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Bot, Sparkles, TrendingUp, Clock, PenTool, Megaphone, Lightbulb, Rocket, Target, BookOpen,
  Smartphone, Image, Search, JapaneseYen, ChartColumn, CircleCheck, Users,
} from 'lucide-react';

const KEYWORDS = [
  [/画像|図解|イラスト|デザイン|image|picture|design|diagram/i, Image],
  [/\bai\b|ＡＩ|ロボ|自動|bot|robot|automation/i, Bot],
  [/時間|時短|スピード|速|clock|time|fast/i, Clock],
  [/お金|収入|稼|売上|円|副業|money|yen|income/i, JapaneseYen],
  [/成長|伸び|増|growth|trend|up/i, TrendingUp],
  [/グラフ|数字|データ|分析|chart|data|analytics/i, ChartColumn],
  [/書く|文章|記事|ライティング|write|writing|pen/i, PenTool],
  [/sns|twitter|発信|集客|宣伝|marketing|megaphone/i, Megaphone],
  [/アイデア|ひらめき|企画|idea/i, Lightbulb],
  [/スタート|始め|挑戦|launch|rocket|start/i, Rocket],
  [/目標|狙|戦略|target|goal/i, Target],
  [/学|本|勉強|book|learn/i, BookOpen],
  [/スマホ|アプリ|phone|mobile|app/i, Smartphone],
  [/検索|リサーチ|調査|search|research/i, Search],
  [/チェック|確認|check/i, CircleCheck],
  [/人|チーム|読者|user|team|people/i, Users],
];

export function iconFor(keyword) {
  return KEYWORDS.find(([re]) => re.test(String(keyword || '')))?.[1] || Sparkles;
}

export function iconSvg(keyword, { color = '#ffffff', strokeWidth = 1.6 } = {}) {
  return renderToStaticMarkup(createElement(iconFor(keyword), { size: 24, color, strokeWidth }));
}
