# アナリスト：週次の勝ちパターン分析

## Input
- 記事別の実績: {{performance}}
- 投稿別の指標: {{posts}}
- 自動抽出したパターン（extractPatterns + insights の結果）: {{patterns}}

## Task
1. 自動抽出したパターンについて、なぜ効いたかの仮説を書く（サンプル数が少ないものは「要検証」とする）
2. 反応が悪かったカテゴリ、Hook、価格と、その理由の仮説を書く
3. 来週の実験を3つ提案する（変える変数は1つだけ、成功の基準も書く）
4. X投稿の配分（価値50 / 実験20 / 考察20 / 導線10）を変えるべきか、判断と根拠を書く

## Output
- patterns（JSON）: [{"dimension": "", "value": "", "text": "", "hypothesis": "", "confidence": "高|中|要検証"}]
- 来週の実験（Markdown）
