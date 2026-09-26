---
description: 毎週日曜の振り返り。数字を分析して学びを貯め、来週の方針を決めてダッシュボードを更新する
---
# /x-weekly：毎週の振り返り

あなた（メインセッション）は X Marketing Company の進行役です。各チームへの依頼は Agent ツール（subagent_type にチーム名）で行い、毎回「今日は D（JST）」「読むファイル」「保存先」を明示します。X への投稿などは一切しません。

## 手順

### 1. 今日の日付を取得する
Bash で `TZ=Asia/Tokyo date +%F` を実行し、今日の日付 D とする（失敗したら `python3 scripts/build_dashboard.py --today`）。
knowledge/profile.md の「アカウント設定」で運用モードを確認する。

### 2. analyst（週次の分析）
> 今日は D（JST）です。週次の振り返りをしてください。
> 読むファイル：inbox/stats/（名前が _ で始まるファイルは除く）、inbox/posted.md、inbox/mentions.md、data/posted.csv、data/metrics.csv、data/post_performance.csv、直近7日の logs/、knowledge/profile.md、knowledge/learnings.md、knowledge/hooks.md
> 保存先：logs/D/weekly-review.md
> 更新するファイル：knowledge/learnings.md、knowledge/hooks.md、data/metrics.csv、data/post_performance.csv

### 3. monetize（導線チェックだけ）
- 運用モードが「収益化」のとき：monetize に「C. 導線チェックだけ」を依頼する
  - 読むファイル：knowledge/products.md、knowledge/profile.md、knowledge/learnings.md、logs/D/weekly-review.md
  - 保存先：logs/D/monetize.md（すでにあれば logs/D/monetize-weekly.md）
- 運用モードが「フォロワー増加」のとき：monetize は動かさない（status は skipped）

### 4. buzz-director（来週の方針）
> 今日は D（JST）です。logs/D/weekly-review.md を読み、来週の方針を logs/D/director-report.md の末尾に「## 来週の方針（週次レビューより）」として追記してください（ファイルがなければ作る）。
> あわせて logs/D/status.json を更新してください。
> - status.json があるとき：analyst を done（file: weekly-review.md）、monetize を（収益化モードで実行したら done、フォロワー増加モードなら skipped）にする
> - status.json がないとき：11チームを入れて新しく作る。analyst・buzz-director は done、monetize は運用モードに応じて done または skipped、ほかのチームは skipped（note：週次のみの日）にする
> 読むファイル：logs/D/weekly-review.md、knowledge/profile.md、knowledge/learnings.md、（あれば）logs/D/director-report.md・logs/D/status.json・logs/D/monetize.md
> 保存先：logs/D/director-report.md、logs/D/status.json

### 5. 検証とダッシュボードの更新
1. Bash で `python3 scripts/build_dashboard.py --check D` を実行する。エラーがあれば buzz-director に直してもらう（最大2回）
2. Bash で `python3 scripts/build_dashboard.py` を実行する

### 6. 結果の表示
weekly-review.md から次を表示する。
- 今週の数字サマリー（フォロワー増加モードなら、フォロワー増減・プロフィールクリック・フォロー率を先頭に）
- 伸びた投稿 TOP3
- 来週の提案（テーマ案・増やす型／減らす型・改善案）
- 最後に：「dashboard/index.html の『成果』『学び』タブで確認できます」
