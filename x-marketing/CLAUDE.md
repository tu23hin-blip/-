# X Marketing Company

## 会社のミッション
X（旧Twitter）運用を仕組み化し、フォロワー増加・リスト構築（LINE登録）・商品販売を実現する。

**現在の重点：フォロワー増加（LINE・販売は収益化モードで開始）**
重点は knowledge/profile.md の「アカウント設定」にある `運用モード` で切り替わる（下の「運用モード」を参照）。

## 組織図
- buzz-director：統括。社長の指示を振り分け計画に落とし、成果物をチェックしてまとめて報告する
- researcher：トレンド・バズ投稿・交流アカウントを調査する
- buzz-writer：バズを狙った勝負ポストを作る
- post-writer：毎日の通常ポストを作る
- reply-worker：交流アカへのリプライ案と、自分へのリプへの返信案を作る
- like-worker：いいね回りの対象リストを作る
- quote-poster：引用ポスト案を作る
- article-writer：X記事（長文）・スレッドを作る
- monetize：商品企画・LINE導線・プロフィール改善を作る（フォロワー増加モードでは /x-monetize のときだけ、フォローされるためのプロフィール改善案を作る）
- analyst：投稿実績の数字を分析し、学びを蓄積する
- checker：全成果物の文字数・事実・NG表現・規約リスクを検査する

## 運用モード
knowledge/profile.md の「アカウント設定」の `運用モード:` の値で動きを切り替える。全チームは作業前に必ず確認する。
値が読めない・未記入のときは「フォロワー増加」として扱う。

| 項目 | フォロワー増加（現在） | 収益化 |
|---|---|---|
| 目的 | フォロワーを増やすことだけ | フォロワー増加＋LINE登録＋商品販売 |
| LINE・商品・販売への言及 | 一切しない（あれば checker が NG） | 週1回まで（超えたら checker が指摘） |
| post-writer | 週1〜2回まで「フォローするメリットが伝わる投稿」（このアカウントで何が学べるか）を入れてよい | 週1回まで商品・LINEに触れてよい |
| article-writer の CTA | フォロー・プロフィールへの誘導 | LINE特典への誘導 |
| monetize | /x-morning・/x-weekly では動かさない（status は skipped）。/x-monetize のときだけ、フォローされるためのプロフィール文・固定ポスト・ヘッダー画像の方向性を作る | 通常どおり（LINE導線・商品企画・導線チェック） |
| analyst の重点 | フォロワー増減・プロフィールクリック・フォロー率（フォロワー増 ÷ プロフィールクリック） | 上記＋LINE登録数 |
| ダッシュボードの KPI | 「LINE登録数」の代わりに「フォロー率」を表示 | 「LINE登録数」を表示 |

## 共通ルール
- ターゲットは「副業・AI活用に興味がある30代〜40代（会社員が中心）」
  - ただし knowledge/profile.md の「アカウント設定」に発信ジャンル・ターゲットが書いてあれば、そちらを優先する。ターゲットが未記入なら「発信ジャンルに興味がある X ユーザー」として扱う
  - 各チームの説明にある「副業・AI」「30〜40代会社員」などの例も、アカウント設定の発信ジャンル・ターゲットに読み替える
- トーンは親しみやすく、専門的すぎない。中学生でもわかる言葉で書く
- inbox/ と knowledge/ にないデータ（フォロワー数・URL・実績数字など）は推測で作らず「不明」と書く
- 見出しに「※例」とついた記入例（〇〇・YYYY-MM-DD などのひな形）は、事実・データ・口調の指定として一切使わない。記入例しかないファイルは「未記入」として扱う（例：voice.md が記入例だけなら、上の「トーン」のルール＝親しみやすく、中学生でもわかる言葉だけで書く）
- ポストは全角140字以内（Xの重み付きカウント280以内）。scripts/count_chars.py で検証する
- 成果物は logs/YYYY-MM-DD/チーム名.md に提出する（ファイル名は各チームの「保存先」に従う）
- 作業前に必ず knowledge/profile.md（アカウント設定）・knowledge/voice.md・knowledge/learnings.md・knowledge/ng-words.md を読む
- 直近7日分の logs/ と inbox/posted.md を見て、同じネタ・同じ型の連続を避ける
- X への投稿・いいね・リプ・フォローは自動で行わない（案とリストの作成まで）。X API やブラウザ自動操作のコードも作らない
- 誇大表現（「誰でも」「絶対」「月100万確定」など）、根拠のない数字、他者への攻撃はしない
- 日付は日本時間（JST）。メインセッションから伝えられた「今日は YYYY-MM-DD」の日付を使う
- パスはすべてこのフォルダ（x-marketing/）からの相対パス

## 本文の書き方（機械で検査するためのルール）
- ポスト・リプ・引用・スレッドの各投稿・告知ポスト・固定ポストなど「X にそのまま貼る文章」は、1本ずつ ```text で始まり ``` で終わるコードブロックに入れる
- プロフィール文（160字以内）は ```profile のコードブロックに入れる
- 1つのコードブロック＝1投稿。コードブロックの中には本文以外（型・文字数・メモ）を書かない
- コードブロックの直前に、ID（例：buzz-01）を含む見出しを書く
- ID の頭文字：buzz（勝負ポスト）／post（通常ポスト）／quote（引用）／reply（交流リプ）／mention（自分へのリプへの返信）／like（いいね）／article（記事・スレッド・告知）／monetize（導線・プロフィール）
- 文字数は `python3 scripts/count_chars.py --md ファイル` で、ファイル内の本文をまとめて検査できる

## 業務フロー（/x-morning）
1. researcher（材料集め）
2. buzz-writer / post-writer / quote-poster / reply-worker / like-worker（並行）
3. article-writer（社長の指示がある日のみ）／monetize（収益化モードで、社長の指示がある日のみ。フォロワー増加モードでは動かさない）
4. checker（機械的な検査）
5. buzz-director（方針チェック・差し戻し・社長向けまとめ・ダッシュボード用データ出力）
6. scripts/build_dashboard.py でダッシュボード更新 → 社長が dashboard/index.html で承認・手動投稿

## 成果物の共通フォーマット
各ファイルの冒頭に以下を書く：
- 作成日／担当チーム／運用モード／参照したファイル一覧／不明だったデータ

## ダッシュボード用データ
### logs/YYYY-MM-DD/status.json（buzz-director が作成）
```json
{
  "date": "YYYY-MM-DD",
  "theme": "今日のテーマ方針",
  "teams": [
    {"name": "researcher", "status": "done|returned|ng|skipped|missing",
     "items": 7, "ng": 0, "note": "一言メモ", "file": "research.md"}
  ],
  "decisions": ["社長の判断が必要なこと"],
  "requests": ["社長にお願いしたい作業"]
}
```
status の意味：done=提出済み／returned=差し戻し後に修正済み／ng=修正後もNG／skipped=今日は稼働なし／missing=未提出

補足：
- teams には11チームすべて（buzz-director 自身も含む）を入れる。稼働しなかったチームは skipped とし、note に理由を書く（例：「フォロワー増加モードのため稼働なし」「週次のみ」）
- file はそのチームの成果物のファイル名（logs/YYYY-MM-DD/ からの名前）。成果物がなければ null

### logs/YYYY-MM-DD/approval.json（buzz-director が作成）
```json
{
  "date": "YYYY-MM-DD",
  "items": [
    {"id": "buzz-01", "kind": "buzz|post|quote|reply|mention-reply|like|article|monetize",
     "time": "07:00", "type": "常識破壊型", "text": "本文（転記）",
     "target": "@相手（リプ・引用・いいねのみ）", "target_url": "URL または null",
     "chars": 264, "check": "OK|要修正|NG", "rank": 1, "recommended": true, "reason": "狙い・理由"}
  ]
}
```

補足：
- id は各チームの .md の ID をそのまま使う（日付の中で重複させない）
- time は "HH:MM"（JST）。リプ・いいねは回る時間帯の代表時刻（朝 07:00／昼 12:00／夜 21:00）。時刻が決まっていないものは ""
- like は text を ""、type を優先度（"優先A"／"優先B"／"優先C"）、chars を 0 にする
- target が不要な種類（buzz・post・article・monetize）は target を ""、target_url を null にする
- rank は同じ kind の中の順位（1が一番おすすめ）。recommended は「今日投稿・実行してほしいもの」に true
- NG のものは recommended を false にする

### data/metrics.csv（analyst が更新）
```
date,followers,impressions,likes,reposts,replies,bookmarks,profile_clicks,line_signups
```

### data/posted.csv（/x-log が追記）
```
posted_at,kind,type,text,url,approval_id
```

### data/post_performance.csv（analyst が更新）
```
url,posted_at,kind,type,time_slot,impressions,likes,reposts,replies,bookmarks,profile_clicks,engagement_rate
```

CSV の補足：
- 数字がわからない項目は空欄（0 や推測値を入れない）
- posted_at は "YYYY-MM-DD HH:MM"（JST）
- approval_id は「日付#ID」（例：2026-09-26#buzz-01）。一致する案がなければ空欄
- time_slot は 朝（5〜9時）／昼（10〜14時）／夕方（15〜18時）／夜（19〜23時）／深夜（0〜4時）のどれか
- engagement_rate は (likes + reposts + replies + bookmarks) ÷ impressions の小数（例：0.034）
- line_signups は収益化モードになってから記入する（フォロワー増加モードの間は空欄）
