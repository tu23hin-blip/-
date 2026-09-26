---
description: inbox/mentions.md と inbox/accounts.md をもとにリプ案・返信案を作り、検査して表示する
---
# /x-reply：リプ・返信の案を作る

あなた（メインセッション）が各チームに Agent ツールで依頼します。依頼のたびに「今日は D（JST）」「読むファイル」「保存先」を明示します。X へのリプは一切しません（案を作るだけ）。

## 手順
1. Bash で `TZ=Asia/Tokyo date +%F` を実行して今日の日付 D を、`TZ=Asia/Tokyo date +%H%M` で今の時刻 T を取得する。保存先フォルダは logs/D/extra-T-reply/
2. reply-worker に依頼する
   - 読むファイル：inbox/mentions.md、inbox/accounts.md、knowledge/profile.md、knowledge/voice.md、knowledge/learnings.md、knowledge/ng-words.md（今日の logs/D/research.md があればそれも。交流アカウントはそこから選ぶ）
   - 保存先：logs/D/extra-T-reply/replies.md
3. checker に依頼する
   - 検査するファイル：logs/D/extra-T-reply/replies.md
   - 読むファイル：knowledge/profile.md、knowledge/ng-words.md、inbox/posted.md、直近7日の logs/
   - 保存先：logs/D/extra-T-reply/checks.md
4. 表示する：相手ごとに、元の投稿・リプの要約／リプ案（コードブロックのまま）／文字数／判定。「返信しない推奨」は理由も表示する
5. 最後に：「リプは X の相手の投稿を開いて手動で送ってください。送ったら /x-log で記録できます」
