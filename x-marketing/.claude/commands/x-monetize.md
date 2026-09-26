---
description: 導線の改善案を作る（フォロワー増加モード：フォローされるためのプロフィール・固定ポスト・ヘッダー／収益化モード：LINE導線・商品企画・導線チェック）
---
# /x-monetize：導線の改善案を作る

あなた（メインセッション）が各チームに Agent ツールで依頼します。依頼のたびに「今日は D（JST）」「読むファイル」「保存先」を明示します。X のプロフィール変更や投稿は一切しません（案を作るだけ）。

## 手順
1. Bash で `TZ=Asia/Tokyo date +%F` を実行して今日の日付 D を、`TZ=Asia/Tokyo date +%H%M` で今の時刻 T を取得する。保存先フォルダは logs/D/extra-T-monetize/
2. knowledge/profile.md の「アカウント設定」で運用モードを確認する
3. monetize に依頼する
   - フォロワー増加モードのとき：「フォロワー増加モードの仕事（フォローされるためのプロフィール文・固定ポスト・ヘッダー画像の方向性）だけをしてください。LINE特典・商品企画・販売導線は出さないでください」と伝える
     - 読むファイル：knowledge/profile.md、knowledge/voice.md、knowledge/learnings.md、直近7日の logs/
   - 収益化モードのとき：「A. LINE導線、B. 商品企画、C. 導線チェックをしてください」と伝える
     - 読むファイル：knowledge/products.md、knowledge/profile.md、knowledge/learnings.md、直近7日の logs/
   - 保存先：logs/D/extra-T-monetize/monetize.md
4. checker に依頼する
   - 検査するファイル：logs/D/extra-T-monetize/monetize.md（固定ポストは280以内、プロフィール文は160字以内）
   - 読むファイル：knowledge/profile.md、knowledge/ng-words.md、inbox/posted.md、直近7日の logs/
   - 保存先：logs/D/extra-T-monetize/checks.md
5. buzz-director に依頼する
   - 伝えること：「monetize.md と checks.md を読み、運用モード・キャラに合っているかを判定し、おすすめ案を1つずつ選んで短くまとめてください（差し戻しが必要なら理由と修正指示も）」
   - 読むファイル：logs/D/extra-T-monetize/monetize.md、logs/D/extra-T-monetize/checks.md、knowledge/profile.md、knowledge/voice.md
   - 保存先：logs/D/extra-T-monetize/director-note.md
6. 差し戻しがあれば monetize に1回だけ修正させ、checker を再実行する
7. 表示する：案の一覧（コードブロックのまま）・文字数・判定・buzz-director のおすすめ
