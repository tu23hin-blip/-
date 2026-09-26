---
description: 実際に投稿した内容を記録する（inbox/posted.md と data/posted.csv に追記し、ダッシュボードを更新）。ダッシュボードの一括コピーもそのまま貼れる
argument-hint: "<投稿本文>（URLがあれば一緒に）"
---
# /x-log：投稿の記録

記録する内容（引数）：

$ARGUMENTS

## 手順
1. 引数が空なら、記録する本文（とあれば投稿URL）を社長に聞く
2. 引数を一字一句そのまま logs/_xlog_input.txt に Write で保存する（前後の空白以外は変えない。要約・整形・翻訳をしない）
3. Bash で `python3 scripts/build_dashboard.py --log logs/_xlog_input.txt` を実行する
   - スクリプトが本文・URL・日時（JST）・種類を読み取り、inbox/posted.md と data/posted.csv に追記し、ダッシュボードを再生成する（入力ファイルは処理後に自動で消える）
   - 日時の指定がなければ「今」（JST）で記録する
   - approval.json の本文と一致するものがあれば、approval_id（例：2026-09-26#buzz-01）も記録する
   - ダッシュボードの一括コピー（`---` 区切りで複数件）を貼られた場合も、すべて記録する
4. スクリプトの出力（記録した件数・各件の日時・種類・本文の1行目・URL・approval_id）を表示する
5. エラーが出たら内容を表示し、どう直せばいいか社長に伝える（CSV を手で書き換えない）
