# データの形式（Google Sheets / Notion）

列名は `src/editorial/data.js` と `engine.js` の関数が受け取るキーに合わせている。

## topics（ネタ候補）
| 列 | 型 | 説明 |
| --- | --- | --- |
| name | text | テーマ |
| source | text | X反応 / Google / ニュース / 過去投稿 / 手動 |
| search | 0-10 | 検索需要 |
| xReaction | 0-10 | Xでの反応 |
| competition | 0-10 | 競合noteの多さ（多いほど高い） |
| monetizable | 0-10 | 有料化しやすさ |
| total | 0-100 | `scoreTopic` の結果 |
| verdict | text | note化 / Xでテスト / 見送り |
| status | text | 候補 → note化承認 → 執筆中 → 公開 |

## notes（記事）
| 列 | 型 | 説明 |
| --- | --- | --- |
| title / hook / keyPoints / result | text | X変換（`repurposeNote`）に渡す |
| theme | text | 勝ちパターン分析で使う切り口 |
| hook_type | text | 数字で結果 / 問いかけ / 逆張り / ハウツー など |
| price | number | 0 は無料 |
| url | text | 公開後に人間が入力する |
| status | text | レビュー待ち → 公開 |

## posts（X投稿）
| 列 | 型 | 説明 |
| --- | --- | --- |
| id / note_id | text | どの記事から作ったか |
| category | text | value / experiment / opinion / cta |
| text | text | 本文 |
| scheduled_at | datetime | 投稿予定 |
| approved | checkbox | 人間の承認 |
| impressions / likes / bookmarks / profileVisits / linkClicks | number | WF4 が更新する |

## performance（記事別の実績。`extractPatterns` の入力）
`title, theme, hook, price, impressions, profileVisits, linkClicks, noteViews, likes, purchases`

## patterns（勝ちパターンDB）
| 列 | 説明 |
| --- | --- |
| dimension | theme / hook / price |
| value | 例：AI自動化 |
| text | 例：「AI自動化」系の記事が売れる |
| lift | 平均比 |
| samples | サンプル数（2未満は採用しない） |
| updated_at | 更新日 |
