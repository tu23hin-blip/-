# AI会社（ai-company）

事業部ごとのAIが裏で作業し、その動きと成果を人間が2つの画面で確認・承認するための仕組みです。

- **経営ダッシュボード**: 売上・前月比・利益・インプレッション・APIコストなどのKPIと、事業部ごとの今週の目標
- **事業部ビュー**: 各事業部AIの状態ランプ、タスク、イベントのタイムライン、成果物、承認待ちの受け箱

AIは **下書きを作るだけ** です。公開・投稿・送信・購入は一切しません（ルールは [CLAUDE.md](./CLAUDE.md)）。
`claude -p` には読み取り系のツール（Read / Glob / Grep / Skill）だけを許可し、書き込み・コマンド実行・Web取得は禁止しています。

---

## 必要なもの（Mac）

| もの | 確認コマンド | 備考 |
|---|---|---|
| Node.js **22.13 以上** | `node -v` | DB に Node 標準の `node:sqlite` を使う（追加のビルド不要）。`brew install node` |
| Claude Code CLI | `claude --version` | ログイン済みであること（`claude` を一度起動してログイン） |
| Git | `git --version` | |

## はじめてのセットアップ

```bash
cd ai-company
```
```bash
cp .env.example .env
```
```bash
npm run setup
```
`npm run setup` は、エンジンと画面の依存パッケージのインストールと DB の作成（`engine/db/ai-company.db`）を行います。

`.env` で設定できるもの（すべて空でも動きます）:

| 変数 | 意味 |
|---|---|
| `DAILY_API_COST_LIMIT_JPY` | 1日のAPIコスト上限（円）。超えたら全事業部を一時停止。空なら上限なし |
| `USD_JPY_RATE` | APIコストを円にするレート。空なら 1ドル=150円で概算し、そのことをイベントに残す |
| `CLAUDE_MODEL` | 使うモデル（空なら Claude Code の既定） |
| `ANTHROPIC_API_KEY` | APIキーで動かす場合のみ。Claude Code にログイン済みなら空でOK |

> Claude のサブスクリプションで動かしている場合、記録される APIコストは `claude -p` が返す「API料金換算の目安」です。実際の請求額とは違うことがあります。

## 画面を見る

```bash
npm run web
```
ブラウザで http://localhost:3000 を開きます。ヘッダーのタブで **経営ダッシュボード／事業部ビュー／承認待ち** を切り替えます（10秒ごとに自動更新）。
同じWi-Fiのスマホからは、Mac の IP アドレスの 3000 番（例: `http://192.168.0.10:3000`）で見られます。

### ダミーデータで試す
```bash
npm run db:seed
```
3事業部・過去30日分の数字・タスク・イベント・承認待ち3件が入ります（数字はすべて架空。画面に「ダミーデータを表示中」と出ます）。
本番運用を始める前に、次のコマンドで消してください:
```bash
npm run db:reset -- --yes
```

## 毎日の使い方

1. AI が定時に下書きを作る（または手動: `npm run division -- x-note`）
2. **承認待ち** タブで内容を確認して「承認／却下／修正を依頼」
   - 警告（⚠）は機械チェックの結果です（文字数・誇大表現・PR表記・AI生成表記など）
   - 「修正を依頼」はコメント必須です。次の実行で修正版が承認待ちに出ます（すぐ作るなら `npm run division -- x-note revise`）
3. 承認したものは「本文をコピー」して、**自分で** X / note に投稿する
4. 投稿したら URL を入れて「投稿済みにする」と、投稿数が記録されます
5. 数字（インプレッション・売上など）は CSV で取り込む

### 数字の取り込み（CSV）
```bash
npm run metrics:import -- data/2026-11.csv
```
```csv
date,division,name,value,url
2026-11-04,x-note,impressions,3120,
2026-11-04,x-note,revenue_jpy,1500,
2026-11-04,x-note,impressions,1820,https://x.com/you/status/123
```
- `name` は `revenue_jpy / impressions / clicks / followers / posts / work_minutes / api_cost_jpy`
- `value` が空欄なら「不明」として記録します（0 とは区別します）
- `url` は任意です。投稿済みにした URL を入れると「投稿ごとの数字」になり、分析担当が伸びた／伸びなかった投稿を判断できます
- 1行でもエラーがあると、何も取り込まずにエラー行を表示します

## 事業部を手動で動かす

```bash
npm run division -- x-note
```
```bash
npm run division -- x-note weekly-note
```
```bash
npm run analyst
```
```bash
npm run division -- short-video
```
- 一時停止中の事業部はスキップされます（`--force` を付けると実行）
- 終了コード: 0=成功、2=失敗、3=スキップ（実行中・一時停止中・コスト上限）

## 定時実行（スケジューラ）

時刻は [`engine/scheduler/schedule.yaml`](engine/scheduler/schedule.yaml) で設定します（cron 形式、`.env` の `TZ`、既定は Asia/Tokyo）。

| ジョブ | 時刻 | 内容 |
|---|---|---|
| `x-note:daily` | 毎朝 7:00 | X投稿案3本 |
| `x-note:weekly-note` | 土曜 7:30 | note記事の下書き |
| `analyst:weekly` | 月曜 8:00 | 週次レポートと目標の更新案 |
| `short-video:main` | 毎朝 9:00 | ショート動画の台本1本 |

### 起動
```bash
npm run scheduler
```
ターミナルを開いたままにしておくと、時刻になったジョブが動きます。

### 停止
スケジューラを動かしているターミナルで **Ctrl+C** を押します。実行中のジョブは止まり、そのタスクは「失敗（停止されました）」として記録されます。

### その他のコマンド
```bash
npm run scheduler:list
```
次回の実行予定を表示します。
```bash
npm run scheduler -- --run-now
```
全ジョブを今すぐ1回ずつ実行して終了します（`--run-now x-note:daily,analyst:weekly` のように選ぶこともできます）。

### 動きのルール
- **並列**: 違う事業部は同時に動きます。**同じ事業部は二重起動しません**（スケジューラが待たせるうえ、ロックファイルで手動実行との重複も防ぎます）。
- **失敗**: events に `fail` を記録し、事業部ビューで赤く表示します。**リトライは1回まで**（60秒後）。それでも失敗したら全社のお知らせに出ます。
- **APIコスト上限**: 今日の `api_cost_jpy` の合計が `DAILY_API_COST_LIMIT_JPY` 以上になると、**全事業部を paused** にします。再開するには次のコマンドを実行します（翌日になれば今日の合計はリセットされます）。
  ```bash
  npm run resume-all
  ```
- **スリープ**: Mac がスリープしていて時刻を過ぎたジョブは、復帰したときに1回ずつ実行します（最大24時間分）。
- 状態の確認と一括操作:
  ```bash
  npm run status
  ```
  ```bash
  npm run pause-all
  ```
  事業部ごとの一時停止と再開は、事業部ビューの詳細画面のボタンでもできます。

### Mac で常駐させる（ログイン時に自動起動）
1. [`engine/scheduler/com.ai-company.scheduler.plist.example`](engine/scheduler/com.ai-company.scheduler.plist.example) をコピーし、`/Users/YOU/ai-company` と node のパス（`which node`）、PATH（`which claude` があるフォルダ）を自分の環境に書き換える
2. 有効にする
   ```bash
   cp engine/scheduler/com.ai-company.scheduler.plist.example ~/Library/LaunchAgents/com.ai-company.scheduler.plist
   ```
   ```bash
   launchctl load ~/Library/LaunchAgents/com.ai-company.scheduler.plist
   ```
3. 止めるとき
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.ai-company.scheduler.plist
   ```
ログは `engine/scheduler/scheduler.log` に出ます。

## 事業部を増やす

仕様書（名前・やること・成果物・頻度・禁止事項）を書くだけで追加できます。

```bash
npm run new-division -- init my-division
```
```bash
npm run new-division -- specs/my-division.yaml
```
1つ目のコマンドで、ひな形から `specs/my-division.yaml` を作ります。それを書き換えてから2つ目のコマンドを実行すると、次の4つがまとめてできます。
- `.claude/skills/my-division/SKILL.md`（Skill）
- `engine/divisions/my-division/division.yaml`（実行設定）
- `engine/scheduler/schedule.yaml` への追記
- DB への登録（事業部ビューにすぐ出ます）

例: [`specs/short-video.yaml`](specs/short-video.yaml)（ショート動画事業部。X＋noteで伸びたテーマを、60秒以内の縦型動画の台本・テロップ・素材リストにする。実在人物の顔は使わない）
ひな形と書き方: [`engine/templates/division-spec.example.yaml`](engine/templates/division-spec.example.yaml)

生成された SKILL.md は自由に手直しできます。複雑な処理が必要な事業部は、分析担当（`engine/divisions/analyst/run.js`）のように `run.js` を置くとそちらで動きます。

## 最初に書き換えてほしいファイル

- [`knowledge/my-voice.md`](knowledge/my-voice.md): 口調のお手本。あなたの過去の投稿を貼ってください
- [`knowledge/my-experience.md`](knowledge/my-experience.md): あなたの実体験と実績の数字。**AIはここにある数字だけを実績として書きます**
- [`knowledge/themes.md`](knowledge/themes.md): 発信テーマ

## 構成

```
ai-company/
├── CLAUDE.md                 全体ルール（AIが必ず守る）
├── knowledge/                判断材料（テーマ・口調・実績・規約・週次レポート）
├── specs/                    事業部の仕様書（new-division の入力）
├── .claude/
│   ├── skills/x-note/        X＋note事業部の Skill
│   ├── skills/short-video/   ショート動画事業部の Skill（new-division で生成）
│   └── agents/analyst.md     分析担当サブエージェント
├── engine/
│   ├── db/                   SQLite（schema.sql）・記録ライブラリ（index.js）・集計（queries.js）・seed・CSV取り込み
│   ├── divisions/<slug>/     事業部ごとの設定（division.yaml）と、必要なら run.js
│   ├── scheduler/            schedule.yaml・スケジューラ・cron
│   ├── templates/            新しい事業部のひな形
│   ├── cli/                  run / new-division / status
│   ├── runner.js             事業部の共通の実行の流れ
│   ├── claude.js             claude -p の呼び出し（読み取り専用ツールのみ）
│   ├── compliance.js         文字数・誇大表現・PR表記・AI生成表記のチェック
│   └── test/                 テスト（npm test）
├── outputs/                  下書き成果物（git管理外）
└── web/                      画面（Next.js）
```

### 記録ライブラリ（engine/db/index.js）
事業部のコードは次の関数で DB に記録します。
```js
import { start_task, log_event, save_output, finish_task, fail_task, record_metric } from './engine/db/index.js';
const id = start_task({ division: 'x-note', title: 'X投稿案3本' });          // events: start
log_event({ task_id: id, message: 'テーマを選定' });                          // events: progress
save_output({ task_id: id, kind: 'x_post', file_path, preview_text });       // approval=pending
finish_task(id);                                                             // events: finish（承認待ちがあれば awaiting_approval）
fail_task(id, err);                                                          // events: fail
record_metric({ date: '2026-11-05', division: 'x-note', name: 'impressions', value: 1200 });
```

### データベース
`divisions / tasks / outputs / events / metrics`（詳細は [`engine/db/schema.sql`](engine/db/schema.sql)）。
指定のカラムに加えて、`outputs.title / outputs.meta`（テーマ・警告・コメント）と `metrics.output_id`（投稿ごとの数字）を足しています。

## テスト

```bash
npm test
```
`claude -p` は偽物（`engine/test/fake-claude.js`）に差し替えて実行するので、APIコストはかかりません。DB・outputs・ロックは一時フォルダを使います。

## うまく動かないとき

| 症状 | 対処 |
|---|---|
| `No such built-in module: node:sqlite` | Node を 22.13 以上にする |
| `claude を起動できません` | `which claude` を確認。launchd の場合は plist の PATH に claude のあるフォルダを入れる |
| 事業部が動かない | `npm run status` で paused になっていないか確認する。コスト上限で止まっていたら `npm run resume-all` |
| ずっと「実行中」のまま | 次の実行時に自動で「中断」扱いになります。すぐ直すなら `npm run division -- <slug>` |
| 画面が古い | `npm run web` を再起動する。DB の場所は `.env` の `DB_PATH` |
