# n8n ワークフロー設計

Makeでも同じノード構成で組める。LLMノードには [`/prompts`](../../prompts) のテンプレートを入れる。
データの保存先は Google Sheets を想定している（形式は [sheets-schema.md](./sheets-schema.md)）。

## WF1：ネタ収集と選定（毎朝 6:00）

```
Cron 6:00
 → HTTP Request: Googleトレンド / ニュースRSS（複数）
 → X API: 自分の直近7日の投稿と指標（GET /2/users/:id/tweets?tweet.fields=public_metrics）
 → Google Sheets: patterns シートを読む（勝ちパターンDB）
 → LLM「AI編集長」(prompts/02-editor-in-chief.md)
      出力：ネタ候補（JSON）と各指標の0〜100評価
 → Code: スコア計算（0〜10に換算して engine.js の scoreTopic と同じ式）
 → Google Sheets: topics シートに追記（status = 候補）
 → Slack/LINE通知：「今日のネタ候補 上位3件」
```

## WF2：note下書き生成（topics.status が「note化承認」になったとき）

```
Google Sheets Trigger（行の更新）
 → LLM リサーチ → 構成 (prompts/03-researcher.md, prompts/04-outliner.md)
 → LLM 本文 → 図解 → アイキャッチ (prompts/05-writer.md, 06-diagrammer.md, 07-eyecatch.md)
 → LLM 校閲 (prompts/08-reviewer.md)。不合格なら最大2回書き直し
 → Google Docs: 下書きを作成
 → Google Sheets: notes シートに追記（status = レビュー待ち）
 → 通知：「下書きができました（人間の最終チェック待ち）」
```

note への公開は人間が行う。公開したら notes.url を入力し、status を「公開」にする。

## WF3：X投稿の生成と予約（notes.status が「公開」になったとき）

```
Google Sheets Trigger
 → LLM X変換 (prompts/09-x-converter.md)：短文3、ノウハウ2、長文1、誘導1
 → Code: 類似度チェック（engine.js の findNearDuplicates。過去30日の投稿も対象）
      類似度0.6以上 → LLMで書き直す（最大2回）→ まだ類似なら人間に回す
 → Code: planSchedule に従って投稿枠へ割り当てる（導線は1日1本まで）
 → Google Sheets: posts シート（status = 承認待ち）
 → 人間が承認（シートのチェックボックス）
 → Cron（毎時）: 承認済みで予定時刻を過ぎたものを X API POST /2/tweets
```

X API で行うのは投稿だけ。自動返信、自動いいね、自動フォローは実装しない。

## WF4：データ収集（毎日 23:00）

```
Cron 23:00
 → X API: 当日と過去7日の投稿の public_metrics / non_public_metrics
      (impression_count, like_count, bookmark_count, user_profile_clicks, url_link_clicks)
 → Google Sheets: posts シートの指標を更新
 → note：公式に提供されている範囲で取得する（ダッシュボードのCSVエクスポートを手動でアップロード）
 → Google Sheets: performance シートに記事別の PV・スキ・購入・売上を反映
```

## WF5：分析と勝ちパターン更新（毎週月曜 7:00）

```
Cron 月曜 7:00
 → Google Sheets: performance / posts を読む
 → Code: extractPatterns + insights（テーマ・Hook・価格ごとの平均比）
 → LLM「アナリスト」(prompts/11-analyst.md)：なぜ勝ったかの仮説と、来週の実験を3つ
 → Google Sheets: patterns シートを更新（WF1 が翌朝から参照する）
 → 通知：週次レポート
```

## 自動化の段階

| Phase | WF1 | WF2 | WF3 | WF4 | WF5 |
| --- | --- | --- | --- | --- | --- |
| 2（テスト期） | 候補を出すだけ | 下書きを人間が大きく直す | 投稿は手動 | 手動集計 | ― |
| 4 | 自動 | 自動（人間は最終チェックだけ） | 承認後に自動投稿 | 自動 | 手動で実行 |
| 5 | 自動 | 自動 | 承認後に自動投稿 | 自動 | 自動 |
