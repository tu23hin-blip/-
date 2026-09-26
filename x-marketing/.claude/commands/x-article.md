---
description: 指定したテーマでX記事（Premium未加入ならスレッド）を作り、検査・チェックして表示する
argument-hint: "<テーマ>"
---
# /x-article：記事・スレッドを作る

テーマ：$ARGUMENTS
（テーマが空なら、何について書くか社長に聞く）

あなた（メインセッション）が各チームに Agent ツールで依頼します。依頼のたびに「今日は D（JST）」「読むファイル」「保存先」を明示します。X への投稿は一切しません。

## 手順
1. Bash で `TZ=Asia/Tokyo date +%F` を実行して今日の日付 D を、`TZ=Asia/Tokyo date +%H%M` で今の時刻 T を取得する。保存先フォルダは logs/D/extra-T-article/
2. article-writer に依頼する
   - 伝えること：「テーマ：（テーマ）」
   - 読むファイル：knowledge/profile.md（X Premium・運用モードを確認）、knowledge/learnings.md、knowledge/voice.md、knowledge/ng-words.md、inbox/posted.md（収益化モードなら knowledge/products.md も）
   - 保存先：logs/D/extra-T-article/article.md
3. checker に依頼する
   - 検査するファイル：logs/D/extra-T-article/article.md
   - 読むファイル：knowledge/profile.md、knowledge/ng-words.md、inbox/buzz-posts.md、inbox/posted.md、直近7日の logs/
   - 保存先：logs/D/extra-T-article/checks.md
4. buzz-director に依頼する
   - 伝えること：「article.md と checks.md を読み、方針・キャラ・運用モードに合っているかを判定し、おすすめの告知ポストと投稿のタイミングを短くまとめてください（差し戻しが必要なら理由と修正指示も）」
   - 読むファイル：logs/D/extra-T-article/article.md、logs/D/extra-T-article/checks.md、knowledge/profile.md、knowledge/voice.md
   - 保存先：logs/D/extra-T-article/director-note.md
5. 差し戻しがあれば article-writer に1回だけ修正させ、checker を再実行する
6. 表示する：タイトル、スレッドの各投稿（または記事の見出し構成）、告知ポスト2案、checks.md の判定、buzz-director のおすすめ
