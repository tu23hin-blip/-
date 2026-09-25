# ADFLOW / AI編集部

広告運用ダッシュボード（ADFLOW）と、note × X の記事制作を自動化する「AI編集部」です。

- **AI編集部の使い方** → [docs/ai-editorial/pipeline.md](docs/ai-editorial/pipeline.md)
- 運用の設計図 → [docs/ai-editorial/blueprint.md](docs/ai-editorial/blueprint.md)
- AI役のプロンプト集 → [docs/ai-editorial-prompts.md](docs/ai-editorial-prompts.md)

## すぐ試す

```
npm install
npx playwright install chromium
npm run demo     # APIを使わずに記事を1本作る（デモ用データ・0円）
npm start        # ダッシュボードを開き、「投稿待ち」を見る
```

本番の制作は `.env.example` を `.env` にコピーして API キーを書き、`npm run produce -- --genre ai-note-automation` を実行します。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run produce -- --genre <ID>` / `--auto` | 記事1本を、ネタ選びから X 投稿の下書きまで制作 |
| `npm run scout` | ジャンル探索 |
| `npm run analyze` | 週次分析（勝ちパターン・ジャンルの継続/撤退） |
| `npm run demo` | APIを使わないお試し制作 |
| `npm run render:samples` | 図解テンプレートの見本を書き出す |
| `npm run prompts` | プロンプト集を `prompts/` に反映 |
| `npm start` / `npm run build` | ダッシュボードの起動 / ビルド |
| `npm test` | テスト |
