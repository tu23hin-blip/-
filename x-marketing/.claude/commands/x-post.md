---
description: 指定したテーマで勝負ポスト・通常ポストの案をその場で作り、検査して表示する
argument-hint: "<テーマ>"
---
# /x-post：その場で1本ほしいとき

テーマ：$ARGUMENTS
（テーマが空なら、何について書くか社長に聞く）

あなた（メインセッション）が各チームに Agent ツールで依頼します。依頼のたびに「今日は D（JST）」「読むファイル」「保存先」を明示します。X への投稿は一切しません。

## 手順
1. Bash で `TZ=Asia/Tokyo date +%F` を実行して今日の日付 D を、`TZ=Asia/Tokyo date +%H%M` で今の時刻 T を取得する。保存先フォルダは logs/D/extra-T-post/（朝の成果物を上書きしないため）
2. buzz-writer と post-writer を1つのメッセージで同時に依頼する
   - 共通で伝えること：「テーマ指定：（テーマ）。このテーマで作ってください」
   - 共通で読むファイル：knowledge/profile.md、knowledge/voice.md、knowledge/learnings.md、knowledge/ng-words.md、knowledge/hooks.md、inbox/posted.md、直近7日の logs/（今日の logs/D/research.md があればそれも）
   - buzz-writer の保存先：logs/D/extra-T-post/buzz-posts.md
   - post-writer の保存先：logs/D/extra-T-post/posts.md
3. checker に依頼する
   - 検査するファイル：logs/D/extra-T-post/buzz-posts.md、logs/D/extra-T-post/posts.md
   - 読むファイル：knowledge/profile.md、knowledge/ng-words.md、inbox/buzz-posts.md、inbox/posted.md、直近7日の logs/
   - 保存先：logs/D/extra-T-post/checks.md
4. 表示する：各案の本文（コードブロックのまま）・文字数（checks.md の数値）・判定。判定が OK のものから、おすすめ1本を理由つきで示す
5. 最後に：「投稿したら /x-log で記録してください」
