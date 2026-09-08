# メディア自走ASP基盤

広告代理店のASP構造（**クライアント → 代理店 → メディア**）のうち、**メディアが担う工程を自走させる**ための実装です。

メディアの仕事は大きく2つ ——
1. **CR制作**（動画広告 / 記事LP / LP）
2. **META（Facebook・Instagram）での運用**

この2つを自動化し、「依頼したものが上がってくる」状態を作ります。さらに、日次報告書の自動生成、
薬機法・景品表示法の表現審査、契約書・請求書の自動作成までを含みます。

```
クライアント ──発注──▶ 代理店 ──発注──▶ メディア（このシステム）
                                              │
     ┌────────────────────────────────────────┴────────────────────────────────┐
     │                                                                          │
     ▼                                                                          ▼
  【制作】構成→台本→法務→AI素材生成→ナレーション→編集→QC          【運用】入稿→配信→実績取得→最適化
     │                                                                          │
     └──────────────▶ 納品 ─▶ META入稿 ─▶ 配信 ──────────────────────────────┤
                                                                                │
        疲弊・在庫不足を検知したら ◀── クリエイティブを自分で発注 ◀─────────────┘

  横断機能: 日次報告書 / 薬機法・景表法チェック / 契約書・請求書 / 収支台帳
```

---

## 1. 動かす

依存パッケージはゼロ（TypeScript は型チェック用の devDependency のみ）。Node.js 22.6 以降が必要です。

```bash
node -v                 # v22.6.0 以上
cp .env.example .env    # 鍵を入れなくても全機能が動きます（後述）

# 一気通貫のデモ：発注 → 制作 → 法務 → 納品 → META入稿 → 運用 → 最適化 → レポート → 請求
npm run cli -- demo

# サーバ起動（API + ワーカー + スケジューラ）
npm start
# → http://localhost:8787/  （デモが出力したAPIキーでログイン）
```

`npm run cli -- demo` は実際に以下を生成します。

| 生成物 | 場所 |
| --- | --- |
| 絵コンテ（カットごとの画） | `var/storage/**/assets/*.svg` |
| ナレーション音声＋読み上げ台本 | `var/storage/**/audio/*.wav` `*.txt` |
| 編集タイムライン（EDL）と ffmpeg コマンド | `var/storage/**/renders/*.edl.json` |
| 動画プレビュー（カット割り・テロップ・尺） | `var/storage/**/renders/*.preview.html` |
| 字幕 | `var/storage/**/renders/*.srt` |
| 記事LP / LP | `var/storage/**/lp/*.html` |
| 日次報告書 | `var/storage/**/reports/daily_*.html` `.md` |
| 請求書 | `var/storage/**/invoices/*.html` |
| 契約書 | `var/storage/**/contracts/*.md` `.html` |

### 鍵がなくても動く理由

すべての外部依存は **mock にフォールバックします**。鍵未設定のプロバイダは自動的に mock 判定になり、
パイプラインは最後まで完走します。これは手抜きではなく設計要件です ——
外部APIの障害や予算枯渇で業務フローが止まらないこと、そして構成・尺・法務・入稿ロジックを
実APIコストゼロで検証できることを狙っています。

mock は「動いたフリ」をしません。閲覧可能なSVG絵コンテ、実尺の無音WAV、実行可能なffmpegコマンドなど、
**中身のあるファイル**を出力し、成果物には `placeholder: true` が必ず立ちます。

---

## 2. 設定（.env）

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `openai`（ChatGPT系） / `anthropic` / `mock` |
| `VIDEO_PROVIDER` | `mock` | `sora` / `seedance` / `astora` / `mock` |
| `IMAGE_PROVIDER` `TTS_PROVIDER` | `mock` | `openai` / `mock` |
| `META_ENABLED` | `false` | `true` で実広告アカウントへ。`false` はサンドボックス |
| `RENDER_ENABLED` | `true` | `false` でレンダリングせずコマンド生成のみ |
| `REPORT_DELIVERY` | `store` | `slack` / `email` / `webhook` / `store` |
| `DAILY_REPORT_CRON_HOUR` | `9` | 日次報告書を生成する時刻（JST） |

動画プロバイダは3つ実装済みです。いずれも「作成 → ポーリング → ダウンロード」の非同期生成APIとして扱い、
`src/providers/video/` の1ファイルを差し替えるだけで他サービスにも対応できます。

- **Sora**（`sora.ts`）— OpenAI。マルチパートで参照画像を渡す image-to-video に対応
- **Seedance**（`seedance.ts`）— ByteDance Ark。`--ratio` `--duration` のコマンド構文でパラメータを渡す方式
- **Astora**（`astora.ts`）— 汎用の非同期生成API形式のアダプタ

---

## 3. 動画制作パイプライン

`src/pipelines/video-ad.ts`。7ステップで、各ステップの入出力と失敗地点は `pipeline_runs` に残ります。

| # | ステップ | 内容 |
| --- | --- | --- |
| 1 | 訴求軸・フックの立案 | フックの型（問題提起／意外性／共感／実演／権威／数値）を変えた複数案 |
| 2 | 構成・絵コンテ・台本 | hook → problem → solution → proof → offer → cta の6〜10カット。カットごとに映像指示・ナレーション・テロップ |
| 3 | **法務プリチェック** | 台本の段階で薬機法・景表法を審査。block なら修正案を台本に反映して再審査 |
| 4 | 素材の生成・引当 | キーフレーム画像を生成 → それを参照した image-to-video で一貫性を担保 |
| 5 | ナレーション合成 | カットごとにTTS。実測尺でカット尺を再調整 |
| 6 | 編集・レンダリング | EDL構築 → ffmpeg |
| 7 | QC | 尺・比率・カット数・**素材の出所**を検証 |

### 素材ポリシー（発注要件の実装）

> 動画に関してはAIでの素材＋提供素材のみで作って

これを「方針」ではなく**コードが強制する不変条件**として実装しています。

- 素材の出所は `ai_generated` / `client_provided` の2値のみ（`assets.source` は CHECK制約付き）
- 絵コンテ生成時に `assertAssetPolicy()` が全カットを検証。提供素材IDが実在しなければAI生成へ落とす
- 各カットの出所は EDL に記録され、プレビューHTMLに「AI生成 / 提供素材」として表示される
- QCで「素材出所が特定できないカット」があればポリシー違反として検出する
- 契約書テンプレート第7条（生成AIの利用）にも同じ制約が入っている

### 編集（EDL）

編集は **EDL（Edit Decision List）という純データ**として組み立て、ffmpeg から独立させています。
同じEDLからは同じ動画が出るため、編集内容をレビュー・差分比較・再現でき、レンダラも差し替えられます。

生成される ffmpeg コマンドが行うこと:

- 素材を**切らずに収める**（`force_original_aspect_ratio=decrease` + `pad`）— 商品や文字が欠けるのを防ぐ
- テロップの焼き込み（縁取り＋半透明帯、Meta UIを避けたセーフエリア内に配置）
- ナレーションをカット開始位置に遅延配置し、BGMとミックス
- `loudnorm=I=-14` でラウドネス正規化

ffmpeg が無い環境では、EDL・実行コマンド・HTMLプレビュー・SRTを成果物として残し、
納品物を `render_pending` としてマークします。QC・法務・入稿の後工程は同じ形で進みます。

---

## 4. META運用

`src/meta/`。Marketing API のキャンペーン階層（campaign → adset → creative → ad）をローカルにミラーします。

- **入稿** — 承認済みクリエイティブから広告文を生成し、法務チェックを通してから入稿。動画/画像のアップロード、Advantage+ 配置、ピクセル・コンバージョンイベント設定まで。新規広告は必ず `PAUSED` で作成する
- **実績取得** — 毎時（当日更新）＋ 6:00 JST（前日確定値）。CV は `offsite_conversion.fb_pixel_purchase` 等の action_type から取り出す
- **最適化** — 下表のルール。**すべて提案として記録**し、案件の `autopilot_level` に応じて適用する

| ルール | 条件 | アクション | auto_safe で自動適用 |
| --- | --- | --- | --- |
| `stop_loss_no_conversion` | 目標CPAの3倍を消化してCV 0 | 広告を停止 | ✅ |
| `stop_loss_high_cpa` | CPA > 目標の1.5倍 | 広告を停止 | ✅ |
| `zero_delivery` | 2日以上IMP 0（審査落ちの疑い） | アラート | ✅ |
| `creative_fatigue` | FRQ ≧ 2.5 または CTRが前期比 -30% | **クリエイティブを自動発注** | ✅ |
| `creative_pool_low` | 配信中クリエイティブ < 3本 | **クリエイティブを自動発注** | ✅ |
| `reduce_underperformer` | CPA > 目標の1.3倍 | 日予算 -20% | ✅ |
| `scale_winner` | CPA ≦ 目標の0.8倍かつCV 3件以上 | 日予算 +20% | ❌（`auto_full` のみ） |
| `budget_pacing` | 月予算の消化ペースが ±20% 超 | アラート | ✅ |

| autopilot_level | 挙動 |
| --- | --- |
| `off` | 何もしない |
| `suggest` | 提案の記録のみ（人が判断） |
| `auto_safe` | **既定**。損失を止める方向だけ自動適用 |
| `auto_full` | 増額・配信開始も自動 |

増額を既定で自動化しないのは、事故ったときの損失が停止より大きいためです。

### 自走ループの折り返し

`creative_fatigue` / `creative_pool_low` を検知すると、システムは**自分でクリエイティブを発注します**
（`optimizer.ts` の `requestCreativeOrder`）。このとき直近でCPAが最も良かった広告のブリーフを引き継ぐので、
勝ち筋を外しません。自動発注は同時2件までに制限され、暴走しません。

発注 → 制作パイプライン → 法務 → 納品 → META入稿 → 配信 → 実績 → 最適化 → 発注、と一周します。

### サンドボックス

`META_ENABLED=false` では、クリエイティブごとの素質・配信日数による疲弊・日次のゆらぎを持つ
擬似実績を**決定論的に**生成します（同じ日・同じ広告なら常に同じ値）。
実アカウントなしで最適化ロジックを検証でき、再実行しても数値が壊れません。

---

## 5. 日次報告書

`src/reports/`。毎日 9:00 JST（`DAILY_REPORT_CRON_HOUR`）に案件ごとに生成・配信します。

1. サマリー / 2. KPI（前日比・目標対比つき） / 3. 予算消化ペース / 4. クリエイティブ別実績 /
5. 実施した運用アクション / 6. 制作進捗 / 7. 法務チェック / 8. アラート / 9. 明日のアクション

**数値はすべてDBの実績から算出し、LLMには解釈と次アクションの文章だけを書かせます。**
数値をLLMに触らせないので、報告書に存在しない数字が載ることはありません。
LLMが落ちても数値ベースの定型文にフォールバックし、レポートは必ず出ます。

配信先は Slack（Block Kit）／ Webhook ／ メール（依存なしのSMTPクライアントを内蔵）／ 保存のみ。
配信失敗は必ず `reports.delivery_status` に記録します（送れたつもりを作らない）。

---

## 6. 法務

### 表現審査（薬機法・景品表示法）

`src/legal/`。**ルールベース → LLM文脈判定 → 修正案生成** の3段構えです。

**組み込み辞書**（`dictionary.ts`, 32エントリ）は薬機法第66〜68条・医薬品等適正広告基準、
および景表法（優良誤認・有利誤認・ステマ規制）に基づきます。重要なのは**カテゴリで可否が変わる**ことです。

| 表現 | 化粧品 | 医薬部外品 | 健康食品 | 医薬品 |
| --- | --- | --- | --- | --- |
| 美白 | ⛔ | ✅ | — | ✅ |
| 育毛・発毛 | ⛔ | ✅ | — | ✅ |
| 治る | ⛔ | ⛔ | ⛔ | ✅ |
| 血圧を下げる | — | — | ⛔（機能性表示食品なら可） | ✅ |

**すり抜け対策** — 全角→半角、記号・空白の除去、小文字化した文字列で照合するため、
「シ・ミ が 消 え る！」のような分断も検出します。検出位置は元テキストのindexに戻して返します。

**LLM文脈判定** — 辞書では拾えない暗示（「毎朝スッキリ」で便通改善を暗示 など）、
打消し表示の不足、体験談による効果保証を検出します。LLMが落ちてもルールベースの結果は必ず返します。

**修正案の生成** — 訴求力を保ったまま適法化した全文を生成します。
極端に短い修正案（原文の40%未満）は本文の切り落としとみなして採用しません。

審査は台本段階・納品前・入稿する広告文・**配信中クリエイティブの週次再監査**の4箇所で走ります。
block 判定のクリエイティブは入稿されません。

```bash
npm run cli -- legal "飲むだけでシミが消える！医師も推薦、効果は100%保証、業界No.1。"
# 判定: block / スコア: 0
#   [block] シミが消える — 化粧品の効能効果の範囲（56項目）を超える。「消える」は医薬品的効能。
#   [block] 医師も推薦 — 医薬関係者による推薦は医薬品等適正広告基準で禁止（効能効果の保証にあたる）。
#   [block] 100%    — 効果・結果の断定は合理的根拠がなければ優良誤認（景表法第5条第1号）。
#   [block] No.1    — 最大級表現は医薬品等適正広告基準で禁止。景表法上も合理的根拠が必要。
#   [warn]  飲むだけで — 簡便性の強調は、効果の保証・誇大広告と評価されるおそれがある。
```

### 契約書

`src/legal/contracts.ts`。4種類のテンプレートを Markdown（監査・差分管理用）＋ HTML（配布用）で生成します。

- **業務委託基本契約書** — 検収、著作権譲渡、再委託、損害賠償上限、反社条項に加え、
  **第5条（広告表現の適法性）** と **第7条（生成AIの利用）** を含む。第7条は素材をAI生成と提供素材に限定し、
  秘密情報が学習に使われない条件での利用、プロンプト・モデル名・生成日時の記録保持を義務づける
- **発注書（個別契約）** — 案件の実データから自動生成
- **秘密保持契約書** — 第3条で「学習に使われうる生成AIへの秘密情報入力」を明示的に禁止
- **メディアパートナー契約（成果報酬型）** — 自己申込・商標無断使用・虚偽体験談の禁止条項つき

### 請求書

`src/legal/invoices.ts`。適格請求書等保存方式（インボイス制度）に対応します。

- **消費税は税率ごとに1回だけ端数処理**（`summarizeTax`）。明細ごとに丸めると1円ずれるので、税率別に合算してから処理する
- 登録番号（T+13桁）、税率別の対価額と消費税額を分けて記載
- 受注者が個人なら**源泉徴収税を自動控除**（100万円以下 10.21% / 超過分 20.42%）
- 三層それぞれの向きに対応 — `receivable`（メディア→代理店の請求書）/ `payable`（代理店→メディアの支払通知書）
- 明細は対象期間の実績（成果報酬・制作費・広告費実費）から自動生成
- 発行時に収支台帳へ計上。`GET /api/projects/:id/ledger` でクライアント売上・メディア原価・広告費・
  代理店マージン・メディア利益が一望できる

---

## 7. アーキテクチャ

```
src/
├── config/env.ts              設定（鍵が無いプロバイダは自動でmockへ）
├── lib/                       ロガー / HTTP(再試行・バックオフ) / 金額・税 / JST日付 / 検証 / テキスト正規化
├── db/
│   ├── schema.sql             21テーブル。CHECK制約でドメイン不変条件を担保
│   └── repositories/          organizations, projects, orders, assets, deliverables,
│                              meta_*, legal_*, invoices, contracts, ledger, reports ...
├── domain/
│   ├── types.ts
│   └── workflow.ts            受注ライフサイクルの状態遷移表（唯一の真実）
├── providers/                 LLM / 動画 / 画像 / TTS / ストレージ のアダプタ層
├── pipelines/
│   ├── engine.ts              ステップごとに進捗をDB保存する実行基盤
│   ├── video-ad.ts / article-lp.ts / lp.ts
│   ├── edl.ts                 編集設計図 → ffmpeg / HTMLプレビュー / SRT
│   └── lp-render.ts           記事LP・LPのHTML生成
├── meta/                      client / publisher / sync / optimizer
├── legal/                     dictionary / scanner / checker / contracts / invoices
├── reports/                   daily / render / delivery
├── queue/                     SQLiteベースのジョブキュー / ワーカー / スケジューラ
├── api/                       依存ゼロのHTTPルータ + 62エンドポイント
└── web/dashboard.ts           ビルド不要の管理画面
```

### 受注ライフサイクル

```
requested → accepted → in_production → internal_review → legal_review ─┬→ approved → delivered → live → completed
                ↑            ↑                                          │
                └── revision ┘                            client_review ┘
```

遷移は `workflow.ts` の遷移表で一元管理し、API・ワーカー・自動運用のどこから叩かれても不正遷移は起きません。
各遷移に副作用（次のジョブ投入）が紐づいており、これが自走の連鎖になっています。
差戻しは履歴から実回数を数えて2回までに制限し、無限ループしません。

### ジョブキュー

SQLite の即時トランザクションで1件ずつ排他取得するため、同じDBを見る**複数プロセスを立ち上げても
二重実行になりません**。失敗は指数バックオフで再試行し、上限超過で `dead` に落として人手に回します。
ワーカーが異常終了して `running` のまま残ったジョブは定期的に回収されます。
`dedupeKey` により多重起票を防ぎます。

```bash
npm run api      # APIのみ
npm run worker   # ワーカー＋スケジューラのみ
```

### 定期実行

| 時刻(JST) | 処理 |
| --- | --- |
| 毎時 | 当日実績の取り込み |
| 06:00 | 前日確定値の取り込み → 自動最適化 |
| 09:00 | 日次報告書の生成・配信（案件別＋全案件サマリー） |
| 月曜 10:00 | 配信中クリエイティブの法務再監査 |
| 月初 11:00 | 前月分の請求書・支払通知書の作成 |

---

## 8. API

62エンドポイント。認証は `Authorization: Bearer <APIキー>`。
キーは平文保存せず SHA-256 のみDBに置き、発行時の応答でしか返しません。
ロールは owner / admin / legal / operator / viewer。

```bash
# 発注（既定で自動受注し、そのまま制作パイプラインが走る）
curl -X POST localhost:8787/api/orders -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "project_id": "prj_xxx",
  "type": "video_ad",
  "title": "9月分 新規クリエイティブ",
  "quantity": 3,
  "brief": {
    "product": "モイストリペアセラム",
    "target": "30〜40代女性・夕方の乾燥が気になる層",
    "painPoints": ["夕方になると肌がつっぱる"],
    "usp": ["高保湿成分を独自比率で配合", "無香料・無着色"],
    "offer": "初回限定 2,980円",
    "durationSec": 20,
    "aspectRatios": ["9:16", "1:1"],
    "variations": 3,
    "providedAssetIds": ["ast_xxx"]
  }
}'

# 進捗（パイプラインのステップ単位で見える）
curl -H "Authorization: Bearer $KEY" localhost:8787/api/orders/ord_xxx
```

主要なエンドポイント:

| 分類 | エンドポイント |
| --- | --- |
| 発注・制作 | `POST /api/orders` `GET /api/orders/:id` `POST /api/orders/:id/transition` `POST /api/orders/:id/rerun` |
| 提供素材 | `POST /api/assets`（base64アップロード） |
| META | `POST /api/projects/:id/meta/account` `.../meta/sync` `.../meta/optimize` `.../meta/activate` `GET .../meta/proposals` |
| 実績 | `GET /api/projects/:id/insights` `GET /api/projects/:id/optimizer-actions` |
| 法務 | `POST /api/legal/check` `GET /api/legal/dictionary` `GET/POST /api/legal/rules` `GET /api/legal/reviews` |
| 契約・請求 | `POST /api/contracts` `POST /api/invoices` `POST /api/invoices/:id/issue` `GET /api/projects/:id/ledger` |
| レポート | `POST /api/projects/:id/reports/daily` `GET /api/reports/:id?format=html` |
| 運用 | `GET /api/status` `GET /api/jobs` `POST /api/jobs/:id/retry` `GET /api/events` |

全経路は `GET /api/routes` で取得できます。

---

## 9. CLI

```bash
npm run cli -- seed                       サンプルデータ作成（APIキー発行）
npm run cli -- demo                       一気通貫デモ
npm run cli -- status                     プロバイダとキューの状態
npm run cli -- order <projectId> <type>   発注して制作まで流す
npm run cli -- work [n]                   キューをn件処理
npm run cli -- sync <projectId> [date]    META実績の取り込み
npm run cli -- optimize <projectId>       自動最適化
npm run cli -- report <projectId> [date]  日次レポート生成
npm run cli -- legal "<text>"             表現チェック
npm run cli -- invoice <projectId> [receivable|payable]
```

## 10. テスト

```bash
npm test        # 40件
npm run typecheck
```

薬機法スキャナ（カテゴリ別可否・分断表現のすり抜け対策・検出位置）、
インボイス制度の端数処理と源泉徴収、ワークフローの遷移表、
EDLのタイムライン計算とffmpegコマンド生成、JST日付境界、
ジョブキューの排他制御・再試行・dead化を検証します。

---

## 11. 本番運用にあたって

このリポジトリは**業務フロー全体が動く実装**ですが、本番投入前に以下の対応が必要です。

- **法務** — 本システムの表現審査は一次スクリーニングです。最終判断は必ず有資格者・法務担当が行ってください。
  辞書は網羅的ではなく、法令・ガイドラインの改正に追随する運用体制が必要です。
  契約書・請求書のテンプレートも締結前に弁護士・税理士の確認を受けてください。
- **秘密情報** — 生成AIに渡すデータが学習に使われない契約条件であることを確認してください（NDA第3条の要請）。
- **Metaトークン** — システムユーザートークンは環境変数ではなくシークレットマネージャに置き、
  `meta_accounts.token_ref` から参照する形に差し替えてください（DBには参照名しか持たせていません）。
- **ストレージ** — `providers/storage/local.ts` を S3 等に差し替えてください（インターフェースは分離済み）。
- **DB** — SQLite は単一ノード向けです。複数ノードで運用する場合は PostgreSQL への移行が必要です
  （リポジトリ層に隔離してあります）。
- **ffmpeg** — 実レンダリングには ffmpeg / ffprobe のインストールが必要です。
  無い環境ではEDLとコマンドのみ出力し、納品物は `render_pending` になります。
