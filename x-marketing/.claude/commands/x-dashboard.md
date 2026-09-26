---
description: ダッシュボード（dashboard/index.html）を最新のデータで作り直し、場所を表示する
---
# /x-dashboard：ダッシュボードの更新

## 手順
1. Bash で `python3 scripts/build_dashboard.py` を実行する
2. 出力に表示された dashboard/index.html の場所（フルパス）を表示する
3. 「ブラウザで開きますか？」と社長に確認する。「はい」なら OS に合わせて次を実行する（実行前に許可を求められることがある）
   - Mac：`open dashboard/index.html`
   - Windows：`start dashboard/index.html`
   - Linux：`xdg-open dashboard/index.html`
4. 開かない場合は「エクスプローラー（Finder）で x-marketing/dashboard/index.html をダブルクリックしてください」と伝える
