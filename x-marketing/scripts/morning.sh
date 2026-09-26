#!/usr/bin/env bash
# 定時実行用：このフォルダで  claude -p "/x-morning auto"  を実行する
# - 今日の logs/ に成果物があれば、/x-morning auto は上書きせずに終了する（社長への確認ができないため）
# - 実行の記録は logs/_cron/YYYY-MM-DD.log に残る
# - 設定例は README.md の「毎朝6:30に自動で動かす（任意）」を参照
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# cron・タスクスケジューラは PATH が短いので、claude がありそうな場所を足す
export PATH="$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# ログイン情報などを環境変数で渡したいときは、リポジトリの外の ~/.x-marketing.env に書く（任意）
if [ -f "$HOME/.x-marketing.env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.x-marketing.env"
fi

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
TODAY="$(TZ=Asia/Tokyo date +%F)"
mkdir -p logs/_cron
LOG="logs/_cron/${TODAY}.log"

if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "$(TZ=Asia/Tokyo date '+%F %T') claude コマンドが見つかりません。README の「困ったとき」を見て CLAUDE_BIN を設定してください" >> "$LOG"
  exit 1
fi

{
  echo "===== $(TZ=Asia/Tokyo date '+%F %T') /x-morning auto 開始 ====="
  "$CLAUDE_BIN" -p "/x-morning auto" --permission-mode dontAsk < /dev/null
  status=$?
  echo "===== $(TZ=Asia/Tokyo date '+%F %T') 終了（終了コード ${status}） ====="
} >> "$LOG" 2>&1

if grep -q "has not been trusted" "$LOG"; then
  {
    echo "⚠️ このフォルダがまだ「信頼」されていないため、.claude/settings.json の許可設定が使われていません。"
    echo "   一度だけ、ターミナルで x-marketing フォルダに移動して claude を起動し、確認画面で「信頼する」を選んでください。"
  } >> "$LOG"
fi

exit "$status"
