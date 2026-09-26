---
description: 毎朝の業務開始。各チームを順番に動かし、今日の投稿案・リプ案・いいねリスト・ダッシュボードを作る（定時実行は /x-morning auto）
argument-hint: "[auto]"
---
# /x-morning：毎朝の業務開始

あなた（メインセッション）は X Marketing Company の進行役です。
- サブエージェントは他のサブエージェントを呼べません。各チームへの依頼は、あなたが Agent ツール（subagent_type にチーム名）で行います
- X への投稿・いいね・リプ・フォローは一切しません。作るのは「案」と「リスト」だけです
- サブエージェントに依頼するときは、毎回必ず「今日は D（JST）」「読むべきファイルのパス」「保存先のパス」を明示します（D は手順1で取得した日付）
- 各チームの成果物の中身は、あなたが書き換えません（直すときは、そのチームに差し戻します）

引数：$ARGUMENTS
- 引数に `auto` があれば「定時実行モード」です。社長には一切質問せず（AskUserQuestion を使わない）、判断が必要なことは director-report.md の「社長の判断が必要なこと」に入れて最後まで進めます

## 手順

### 1. 今日の日付を取得する
Bash で `TZ=Asia/Tokyo date +%F` を実行し、出力（YYYY-MM-DD）を今日の日付 D とする。
- 失敗したとき（Windows など）は `python3 scripts/build_dashboard.py --today` を使う
- 提出先は logs/D/。フォルダは最初のファイルを保存したときに自動で作られるので、mkdir は使わない

### 2. 今日の成果物がすでにないか確認する
Glob で `logs/D/*.md` と `logs/D/*.json` を探す。
- 1つもなければ手順3へ
- 1つでもあれば：
  - 定時実行モード：何も変更せず、「logs/D/ に成果物があるため、上書きせずに終了しました」とだけ表示して終了する（手順3以降は行わない。サブエージェントも呼ばない）
  - 通常：見つかったファイル名を示して、上書きしてよいか社長に確認する。「いいえ」なら何もせずに終了。「はい」なら続行する（各チームは同じファイル名で上書き保存する）

### 3. 振り分け計画（buzz-director・仕事A）
knowledge/profile.md の「アカウント設定」を読み、運用モードを確認してから依頼する。
> 今日は D（JST）です。仕事A（振り分け計画）をしてください。
> 読むファイル：inbox/instructions.md、knowledge/profile.md、knowledge/learnings.md、knowledge/voice.md、knowledge/ng-words.md、直近7日の logs/*/director-report.md
> 保存先：logs/D/director-plan.md

完成したら director-plan.md の `稼働:` の行を読み、今日動かすチームを決める。
運用モードが「フォロワー増加」なら、`稼働:` に monetize があっても動かさない。

### 4. researcher（材料集め）
> 今日は D（JST）です。director-plan.md のテーマ方針に沿って、バズ分析・ネタ候補・交流アカウント選定をしてください。
> 読むファイル：logs/D/director-plan.md、inbox/buzz-posts.md、inbox/accounts.md、inbox/posted.md、knowledge/profile.md、knowledge/hooks.md、knowledge/idea-bank.md、knowledge/voice.md、knowledge/learnings.md、knowledge/ng-words.md
> 保存先：logs/D/research.md（追記先：knowledge/hooks.md、knowledge/idea-bank.md）

### 5. 5チームを並行で実行
research.md ができたら、次の5チームを1つのメッセージで同時に依頼する（並行実行）。

共通で読むファイル：logs/D/director-plan.md、logs/D/research.md、knowledge/profile.md、knowledge/voice.md、knowledge/learnings.md、knowledge/ng-words.md、inbox/posted.md、直近7日の logs/

| チーム | 追加で読むファイル | 保存先 |
|---|---|---|
| buzz-writer | knowledge/hooks.md | logs/D/buzz-posts.md |
| post-writer | （共通のみ） | logs/D/posts.md |
| quote-poster | inbox/buzz-posts.md | logs/D/quotes.md |
| reply-worker | inbox/accounts.md、inbox/mentions.md | logs/D/replies.md |
| like-worker | inbox/accounts.md、inbox/mentions.md | logs/D/likes.md |

### 6. article-writer / monetize（計画で指示された日だけ）
- article-writer：`稼働:` にあれば依頼する
  - 読むファイル：logs/D/director-plan.md、inbox/instructions.md、logs/D/research.md、knowledge/profile.md、knowledge/learnings.md、knowledge/voice.md、knowledge/ng-words.md（収益化モードなら knowledge/products.md も）
  - 保存先：logs/D/article.md
- monetize：運用モードが「収益化」で、`稼働:` にあるときだけ依頼する
  - 読むファイル：knowledge/products.md、knowledge/profile.md、knowledge/learnings.md、直近7日の logs/
  - 保存先：logs/D/monetize.md
- フォロワー増加モードでは monetize は動かさない（status.json では skipped）

### 7. checker（機械的な検査）
> 今日は D（JST）です。logs/D/ の提出物（buzz-posts.md、posts.md、quotes.md、replies.md、likes.md。ある場合は article.md・monetize.md）を検査してください。
> 読むファイル：上の提出物、knowledge/profile.md、knowledge/ng-words.md、inbox/buzz-posts.md、inbox/posted.md、直近7日の logs/
> 保存先：logs/D/checks.md

### 8. 成果物チェックと差し戻し（buzz-director・仕事B）
> 今日は D（JST）です。仕事B（成果物チェック）をしてください。
> 読むファイル：logs/D/ の全成果物と checks.md、logs/D/director-plan.md、knowledge/profile.md、knowledge/voice.md
> 保存先：logs/D/director-review.md

director-review.md の `差し戻し先:` の行を読む。
- 「なし」なら手順9へ
- チーム名があれば、そのチームに差し戻す（複数なら並行でよい）
  - 依頼文には director-review.md の該当行（対象・理由・修正指示）を貼り、「同じ保存先に上書き保存。修正した ID の見出しに（修正済み）と書く」と伝える
  - 修正が終わったら checker を再実行して logs/D/checks.md を上書きする
- 差し戻しは最大1回まで。再検査後も NG が残ったものは、手順9で「社長の判断が必要なこと」に入れてもらう

### 9. 日次報告とダッシュボード用データ（buzz-director・仕事C・D）
> 今日は D（JST）です。仕事C（社長向け日次報告）と仕事D（status.json・approval.json）をしてください。
> 差し戻しの結果：（差し戻したチームと ID、再検査後も NG の ID。なければ「差し戻しなし」）
> 稼働しなかったチーム：（例：article-writer＝社長の指示なし、monetize＝フォロワー増加モードのため稼働なし、analyst＝週次のみ）
> 読むファイル：logs/D/ の全ファイル、knowledge/profile.md、knowledge/learnings.md
> 保存先：logs/D/director-report.md、logs/D/status.json、logs/D/approval.json

### 10. JSON の検証
Bash で `python3 scripts/build_dashboard.py --check D` を実行する。
- 「エラー 0件」なら次へ（警告は最後の表示に含めるだけでよい）
- エラーがあれば、エラーの全文を buzz-director に渡して status.json / approval.json を直してもらい、もう一度検証する（最大2回。それでも直らなければ、エラー内容を最後の表示に含める）

### 11. ダッシュボードを更新する
Bash で `python3 scripts/build_dashboard.py` を実行する。

### 12. 社長への表示
logs/D/director-report.md を読み、次を画面に表示する。
- 今日の結論（3行）
- 社長の判断が必要なこと
- 最後に必ず：「dashboard/index.html を開いて承認・投稿してください。投稿したら /x-log で記録してください」
