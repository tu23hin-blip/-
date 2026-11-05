# AI会社（ai-company）

事業部ごとのAIが裏で作業し、その動きと成果を人間が2つの画面で確認・承認するための仕組みです。

- **経営ダッシュボード** … 売上・利益・インプレッション・APIコストなどのKPI
- **事業部ビュー** … 各事業部AIの実行状況、イベントのタイムライン、承認待ちの受け箱

AIは **下書きを作るだけ** で、公開・投稿・送信・購入は一切しません（ルールは [CLAUDE.md](./CLAUDE.md)）。

## 構成

```
ai-company/
├── CLAUDE.md              全体ルール（AIが必ず守る）
├── README.md
├── .env.example           環境変数のひな形（値は空）
├── knowledge/             判断材料（テーマ・口調・週次レポート）
├── .claude/
│   ├── skills/            事業部ごとの Skill（例: x-note/SKILL.md）
│   └── agents/            サブエージェント（例: analyst.md）
├── engine/
│   ├── db/                SQLite と記録用ライブラリ
│   ├── divisions/         事業部ごとの実行コード（claude -p で Skill を呼ぶ）
│   └── scheduler/         定時実行（schedule.yaml）
├── outputs/               下書き成果物（git管理外）
└── web/                   画面（Next.js）
```

### 事業部の追加
事業部を1つ増やす ＝ 次の2つを足すだけ、になるように作っています。
- `.claude/skills/<slug>/SKILL.md`
- `engine/divisions/<slug>/`

予定している事業部：X＋note（最初）／ショート動画／自サイト（LLMO）

## 必要なもの（Mac）

- Node.js 22 以上（`node -v` で確認）
- Claude Code CLI（`claude -p` が使えること）
- Git

## セットアップ

```bash
cd ai-company
cp .env.example .env   # 必要な値を入れる
```

> DB・画面・エンジンの起動方法は、各フェーズの実装に合わせてここに追記していきます。

## 開発フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| 0 | 土台（フォルダ構成・ルール・README） | ✅ |
| 1 | データベースと記録の仕組み | |
| 2 | 経営ダッシュボード | |
| 3 | 事業部ビュー（AIの動きの可視化） | |
| 4 | X＋note事業部 | |
| 5 | 分析担当 | |
| 6 | 定時実行と並列化 | |
| 7 | 事業部を増やす仕組み | |
