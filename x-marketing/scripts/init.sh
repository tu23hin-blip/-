#!/usr/bin/env bash
# 初期設定：templates/ から inbox/・knowledge/・data/ を作る
# - すでにあるファイルは絶対に上書きしない（何度実行しても安全）
# - 使い方：x-marketing フォルダで  bash scripts/init.sh
set -euo pipefail

cd "$(dirname "$0")/.."

created=0
kept=0

for dir in inbox knowledge data; do
  if [ ! -d "templates/$dir" ]; then
    echo "エラー：templates/$dir が見つかりません（x-marketing フォルダで実行してください）"
    exit 1
  fi
  while IFS= read -r src; do
    dest="${src#templates/}"
    if [ -e "$dest" ]; then
      echo "そのまま：$dest（すでにあるので上書きしません）"
      kept=$((kept + 1))
    else
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
      echo "作成：$dest"
      created=$((created + 1))
    fi
  done < <(find "templates/$dir" -type f ! -name '.DS_Store' | sort)
done

mkdir -p logs dashboard

echo ""
echo "完了：新しく作成 ${created} 件／すでにあったのでそのまま ${kept} 件"
echo "次は knowledge/profile.md・knowledge/voice.md を記入してください（README.md の「最初の1回だけやること」）"
