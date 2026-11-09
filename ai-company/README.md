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
| `X_MAIN_*` / `X_SUB_*` / `X_FETCH_DAYS` | X の投稿の数字の自動取り込み（[X APIの設定](#x-apiの設定)）。空ならスキップ |
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

数字の取り込み → 下書きの生成 → 人の確認と投稿、の順に毎日回ります。X の数字は自動で入るので、人がやるのは **確認・投稿・売上の入力** だけです。

| 時刻 | 自動で動くもの | 人がやること |
|---|---|---|
| 毎朝 6:00 | **X の投稿の数字を取り込み**（`metrics:x`。直近3日の自分の投稿のインプレッション・クリック） | なし |
| 毎朝 7:00 | X＋note事業部が X投稿案を3本作る（取り込んだ数字と仮説を見て「伸びた型」2本＋「新仮説」1本） | 承認待ちを確認する |
| 毎朝 9:00 | ショート動画事業部が台本を1本作る | 承認待ちを確認する |
| 土曜 7:30 | note記事の下書き | 承認待ちを確認する |
| 月曜 8:00／木曜 8:00 | 分析担当が週次レポート／中間レポートと目標の変更案を作る | レポートを読み、変更案を承認／却下 |
| 売れた日 | — | ダッシュボードで売上と販売件数を入れる |

### 1. 朝: 下書きを確認して投稿する（承認待ち タブ）
1. **承認待ち** タブで内容を見て「承認／却下／修正を依頼」
   - **仮説**: X投稿には1本ずつ、何を試したかが1行で付いています。3本のうち2本は【伸びた型】（直近で数字が良かった型をなぞる）、1本は【新仮説】（型を1か所だけ変えて試す）
   - **警告（⚠）** は機械チェックの結果です（文字数・誇大表現・PR表記・AI生成表記・仮説の書き忘れなど）
   - 「修正を依頼」はコメント必須です。次の実行で修正版が承認待ちに出ます（すぐ作るなら `npm run division -- x-note revise`）
2. 承認したものは「本文をコピー」して、**自分で** X / note に投稿する（AIもプログラムも投稿はしません）
3. 投稿URLの登録は **X なら不要** です。翌朝6時の取り込みで、承認済み・未投稿の下書きと本文の先頭40字を照合し、一致したものを自動で「投稿済み」にしてURLを登録します（イベントログに記録されます）
   - 書き出しが同じ下書きが2つ以上あるときは自動で決めません。承認待ちタブで URL を入れて「投稿済みにする」を押してください
   - X 以外（note・Instagram・動画など）は、投稿したら URL を入れて「投稿済みにする」を押します

### 2. 投稿の数字（X は自動、ほかの媒体は手入力）
- **X**: 毎朝6時に、直近3日（`X_FETCH_DAYS`）の自分の投稿のインプレッションとクリックを取り込みます。インプレッションは2〜3日でほぼ伸びきるので、それより古い投稿は最後に取った値のまま残ります
- **X 以外の媒体、または X API が止まっているとき**: 承認待ちタブの「投稿済み」カードにインプレッションとクリックを入れて「数字を保存」
  - 入れる値は **その時点の累計** です
- どちらも **投稿ごとに1行** で上書きします（日付は投稿日で固定）。何度入れても行は増えず、合計で二重に数えることはありません
- 空欄の項目は変更しません。X で URL のクリック数が取れない投稿は、クリックが空のままになります

### 3. 売れたら: 売上と販売件数を入れる（経営ダッシュボード）
- 経営ダッシュボードの **売上・件数の入力** で、事業部・日付・売上（円）・販売件数を入れて「保存」。すぐに表示に反映されます
  - note・ASP などの管理画面を見て、その日の合計を入れます（同じ日に入れ直すと上書き。空欄の項目は変更しません。未来の日付は不可）
  - 事業部と日付を選ぶと、その日に記録済みの値が薄く表示されます
- KPIカードの **販売件数** と **平均単価（売上 ÷ 件数）**、事業部ごとの表の **今週の件数** に出ます。平均単価は、売上と件数が **両方記録された日だけ** で計算します

### 4. 週2回: レポートを読む
- 分析担当が **月曜8時に週次レポート**（先週の月〜日と前週）、**木曜8時に中間レポート**（直近7日とその前7日）を作ります
- ダッシュボード下の「レポート（週次・中間）」から開けます。ファイルは `outputs/reports/` と `knowledge/reports/`
- どの仮説が当たった／外れたかと、次の方針案3つが書かれます
- 今週の目標の変更案は承認待ちに出ます。**承認したときだけ** 目標が書き換わります（同じ案が承認待ちに残っていれば重ねて出しません）
- 数字が足りないときは、レポートの「入力してほしい数字」に何を入れればよいかが書かれます

### 5. ときどき: 取り込みがうまくいっているか見る（事業部ビュー）
- 事業部ビューの **数字の取り込み** カードで、毎朝の結果（読んだ件数・推定費用・自動ひも付けの件数）がタイムラインに出ます
- 失敗すると赤くなります。クレジット切れ（402）やキーの間違い（401/403）は日本語で原因が出ます。対処は「[X APIの設定](#x-apiの設定)」を参照
- 取り込みが失敗しても、7時以降の生成ジョブはいつもどおり動きます（前日までの数字で判断します）

### 数字の入れ方のまとめ

| 数字 | どこで入れるか | 単位・意味 |
|---|---|---|
| X の投稿ごとのインプレッション・クリック | **自動**（毎朝6時、`npm run metrics:x`） | その時点の累計。投稿ごとに1行で上書き |
| X 以外の投稿ごとのインプレッション・クリック | 承認待ちタブ → 投稿済みカード／CSV（`url` 列つき） | その時点の累計。投稿ごとに1行で上書き |
| 売上 `revenue_jpy` | 経営ダッシュボードの「売上・件数の入力」／CSV | その日の合計（円） |
| 販売件数 `sales_count` | 経営ダッシュボードの「売上・件数の入力」／CSV | その日に売れた件数 |
| 投稿数 `posts` | 自動（自動ひも付け、または「投稿済みにする」） | 投稿日の本数 |
| APIコスト `api_cost_jpy` | 自動（AIの実行ごと、X の取り込みごと） | 円 |
| 事業部全体のインプレッション・クリック、フォロワー、作業時間 | CSV | 日別の合計（フォロワーはその日の人数） |

### 数字の取り込み（CSV）
まとめて入れたいとき、画面に入力欄がない数字（事業部全体のインプレッション・フォロワー・作業時間など）を入れるときに使います。
```bash
npm run metrics:import -- data/2026-11.csv
```
```csv
date,division,name,value,url
2026-11-04,x-note,impressions,3120,
2026-11-04,x-note,revenue_jpy,1500,
2026-11-04,x-note,sales_count,3,
2026-11-04,x-note,followers,1024,
2026-11-06,x-note,impressions,1820,https://x.com/you/status/123
```
- `date` は `YYYY-MM-DD`（`2026/11/04` も可）、`division` は slug（`x-note`）か事業部名
- `name` は `revenue_jpy / sales_count / impressions / clicks / followers / posts / work_minutes / api_cost_jpy`
- `value` が空欄なら「不明」として記録します（0 とは区別します）。`1,200` や `¥1,500` も読めます
- `url` は任意です。登録済みの投稿URLを入れると **投稿ごとの数字**（その時点の累計）になり、画面の手入力・X の自動取り込みと同じく **投稿ごとに1行で上書き** します（`date` 列ではなく投稿日で記録）
- 同じ `date,division,name`（と同じ url）は上書きされます
- 1行でもエラーがあると、何も取り込まずにエラー行を表示します

### 古い DB を使っている場合
`sales_count` の追加で DB の形式が変わりました。以前から使っている DB では、次のコマンドを1回実行してください（データは保持されます。実行前に `engine/db/backups/` にバックアップを作ります）。
```bash
npm run db:migrate
```
`npm run setup`（`npm run db:init`）でも同じ移行が行われます。移行前の DB を開こうとすると、画面やコマンドが「npm run db:migrate を実行してください」と表示して止まります。

## X APIの設定

X の投稿の数字（インプレッション・クリック）を毎朝6時に自動で取り込むための設定です。設定しなくても、ほかの機能はすべて動きます（キーが空のアカウントは何もせずスキップします）。

### 1. キーを用意する（アカウントごとに別の開発者アプリ）
1. X の開発者コンソール（console.x.com）で、**数字を取りたいアカウントごとに** アプリを作る（メイン用・サブ用で別のアプリ）
2. アプリの権限は **Read** で十分です（投稿はしないので Write は不要）
3. 「Keys and tokens」で次の4つを発行する。**Access Token は、数字を取りたいアカウントでログインした状態で発行** します（自分の投稿を自分のアプリで読む＝Owned Reads にするため）
   - API Key / API Key Secret / Access Token / Access Token Secret
4. クレジット（従量課金）を少額チャージしておく

### 2. `.env` に入れる
```bash
open -e .env
```
```
X_MAIN_API_KEY=（メインのアプリの API Key）
X_MAIN_API_SECRET=（API Key Secret）
X_MAIN_ACCESS_TOKEN=（Access Token）
X_MAIN_ACCESS_TOKEN_SECRET=（Access Token Secret）
X_SUB_API_KEY=（サブのアプリの API Key）
X_SUB_API_SECRET=
X_SUB_ACCESS_TOKEN=
X_SUB_ACCESS_TOKEN_SECRET=
X_FETCH_DAYS=3
```
- `.env` は git の管理外です。キーはログ・イベント・DB・エラーメッセージにも出しません（DB に保存するのは自分のユーザーIDと、トークンの短いハッシュだけ）
- 4つのうち1つでも空のアカウントはスキップします

### 3. どのキーをどの部門に使うか
[`engine/integrations/x-accounts.yaml`](engine/integrations/x-accounts.yaml) に書きます。
```yaml
accounts:
  - { env_prefix: X_MAIN, divisions: [x-note] }
  - { env_prefix: X_SUB,  divisions: [sub-x] }
```
`divisions` の部門がまだ登録されていないアカウントは、API を呼ばずにスキップします（sub-x は `npm run new-division` で登録すると対象になります）。

### 4. 1回動かして確認する
```bash
npm run metrics:x
```
事業部ビューの「数字の取り込み」に、読んだ件数・推定費用・更新した件数・自動ひも付けの件数が出ます。同じ日の2回目は何もしません（やり直すときだけ `npm run metrics:x -- --force`）。

### 費用を抑えるための決まり（コードで守っています）
| 決まり | 理由 |
|---|---|
| 自分の投稿は `GET /2/users/{自分のid}/tweets` だけで読む | 自分のアプリで自分の投稿を読む「Owned Reads」は1件 **$0.001**。`GET /2/tweets?ids=...` は通常料金（$0.005、5倍）なので使わない |
| 自分のユーザーIDは `GET /2/users/me` で **最初の1回だけ** 取り、DB（app_meta）に保存 | 毎回呼ばない。Access Token を入れ替えたときだけ取り直す |
| 読む範囲は `start_time` = 今から `X_FETCH_DAYS` 日前（既定3日） | インプレッションは2〜3日でほぼ伸びきる。古い投稿は最後に取った値のまま |
| 実行は1日1回（毎朝6時） | 同じ日の2回目は呼ばない |
| `max_results=100`、`tweet.fields=public_metrics,non_public_metrics,created_at` の1回で取る | 1日3本なら、読むのは毎日10件前後（推定 $0.01／日） |
| 投稿のAPIは作らない | 投稿は人が手動で行う（APIでの投稿は1件 $0.015、URL付きは $0.20） |
| 認証は OAuth 1.0a。署名は `node:crypto` で自前実装 | 外部ライブラリを入れない |

- 推定費用（読んだ件数 × $0.001）は毎回イベントログに記録し、APIコスト（`api_cost_jpy`）にも入れます。1日のAPIコスト上限（`DAILY_API_COST_LIMIT_JPY`）の計算にも含まれます
- 取り込む数字: インプレッション = `public_metrics.impression_count`、クリック = `non_public_metrics.url_link_clicks`（取れない投稿は空のまま）

### エラーのとき
| 表示 | 原因と対処 |
|---|---|
| クレジットが切れています（402 CreditsDepleted） | 開発者コンソールでクレジットを追加する。翌朝から自動で再開します（リトライはしません） |
| キーが正しくありません（401） | `.env` の4つのキーを確認する。作り直した場合は4つとも入れ替える |
| キーかアプリの権限が正しくありません（403） | アプリの権限（Read 以上）と、4つのキーが同じアプリのものかを確認する |
| 回数制限にかかりました（429） | 時間をおいて `npm run metrics:x -- --force` |

取り込みが失敗しても、毎日の生成ジョブはそのまま動きます。

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
npm run analyst:midweek
```
```bash
npm run metrics:x
```
```bash
npm run division -- short-video
```
- 一時停止中の事業部はスキップされます（`--force` を付けると実行）
- 終了コード: 0=成功、2=失敗、3=スキップ（実行中・一時停止中・コスト上限）、4=失敗（クレジット切れ・キーの間違いなど、リトライしても直らないもの）

## 定時実行（スケジューラ）

時刻は [`engine/scheduler/schedule.yaml`](engine/scheduler/schedule.yaml) で設定します（cron 形式、`.env` の `TZ`、既定は Asia/Tokyo）。

| ジョブ | 時刻 | 内容 |
|---|---|---|
| `metrics:x` | 毎朝 6:00 | X の投稿の数字を取り込み（失敗しても他のジョブは動く。402/401/403 はリトライしない） |
| `x-note:daily` | 毎朝 7:00 | X投稿案3本 |
| `x-note:weekly-note` | 土曜 7:30 | note記事の下書き |
| `analyst:weekly` | 月曜 8:00 | 週次レポート（先週の月〜日と前週）と目標の更新案 |
| `analyst:midweek` | 木曜 8:00 | 中間レポート（直近7日とその前7日）と目標の更新案 |
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

**別アカウントの部門**（例: sub-x / sub-insta / sub-note）は、仕様書に `アカウント: sub` を書くか、`--account sub` を付けて登録すると、口調・実体験・テーマを [`knowledge/accounts/sub/`](knowledge/accounts/sub/)（`voice.md` / `experience.md` / `themes.md`）から読みます。
```bash
npm run new-division -- specs/sub-x.yaml --account sub
```
成果物が X投稿の部門には、「3本のうち2本は直近で伸びた型、1本は新しい仮説を試す」ルールが自動で入ります。X の数字を取り込むには `engine/integrations/x-accounts.yaml` の `divisions` にその部門を書きます（sub-x は記載済み）。

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
│   ├── integrations/         外部サービス（x-accounts.yaml と X API の取り込み）
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
// 画面からの入力も同じライブラリ経由（recorder() で取得）
//   record_output_metrics(outputId, { impressions, clicks })   投稿ごと・今日時点の累計
//   record_sales({ division, date, revenue_jpy, sales_count }) 売上と販売件数
```

### データベース
`divisions / tasks / outputs / events / metrics`（詳細は [`engine/db/schema.sql`](engine/db/schema.sql)）。
指定のカラムに加えて、`outputs.title / outputs.meta`（テーマ・仮説・警告・コメント）と `metrics.output_id`（投稿ごとの数字）を足しています。
形式の変更は [`engine/db/migrate.js`](engine/db/migrate.js)（`npm run db:migrate`）で行います。

## テスト

```bash
npm test
```
`claude -p` は偽物（`engine/test/fake-claude.js`）に、X API はスタブに差し替えて実行するので、APIコストはかかりません（テスト中は `.env` を読まず、本物のネットワークを呼ぶとテストが失敗します）。DB・outputs・ロックは一時フォルダを使います。

## うまく動かないとき

| 症状 | 対処 |
|---|---|
| `No such built-in module: node:sqlite` | Node を 22.13 以上にする |
| `DBの形式が古いです` | `npm run db:migrate` を実行する（データは保持） |
| 「数字の取り込み」が赤い | タイムラインのメッセージを見る。402/401/403 の対処は「X APIの設定」の「エラーのとき」 |
| X の投稿が自動で投稿済みにならない | 本文の先頭40字が下書きと違う（投稿前に書き換えた）か、同じ書き出しの下書きが複数ある。承認待ちタブで URL を入れる |
| `claude を起動できません` | `which claude` を確認。launchd の場合は plist の PATH に claude のあるフォルダを入れる |
| 事業部が動かない | `npm run status` で paused になっていないか確認する。コスト上限で止まっていたら `npm run resume-all` |
| ずっと「実行中」のまま | 次の実行時に自動で「中断」扱いになります。すぐ直すなら `npm run division -- <slug>` |
| 画面が古い | `npm run web` を再起動する。DB の場所は `.env` の `DB_PATH` |
