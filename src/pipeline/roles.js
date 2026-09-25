// 各AI役の定義。prompt は prompts/ のファイル名、required は返すJSONに必須の項目。
// expectedOutputTokens / typicalInputTokens は費用の概算に使う（思考トークンを含めて多めに見積もる）。

export const ROLES = {
  genreScout: { prompt: '01-genre-scout', label: 'ジャンルスカウト', required: ['candidates'], typicalInputTokens: 6000, expectedOutputTokens: 8000, maxTokens: 32000 },
  editorInChief: { prompt: '02-editor-in-chief', label: '編集長', required: ['ideas'], typicalInputTokens: 6000, expectedOutputTokens: 8000, maxTokens: 32000 },
  researcher: { prompt: '03-researcher', label: 'リサーチャー', webSearch: true, required: ['facts'], typicalInputTokens: 3000, expectedOutputTokens: 10000, maxTokens: 32000 },
  outliner: { prompt: '04-outliner', label: '構成作家', required: ['title_candidates', 'sections'], typicalInputTokens: 8000, expectedOutputTokens: 8000, maxTokens: 32000 },
  writer: { prompt: '05-writer', label: 'ライター', required: ['title', 'body_markdown'], typicalInputTokens: 12000, expectedOutputTokens: 24000, maxTokens: 64000 },
  diagrammer: { prompt: '06-diagrammer', label: '図解デザイナー', required: ['diagrams'], typicalInputTokens: 14000, expectedOutputTokens: 8000, maxTokens: 32000 },
  eyecatch: { prompt: '07-eyecatch', label: 'アイキャッチ', required: ['layout', 'main_copy'], typicalInputTokens: 2000, expectedOutputTokens: 3000, maxTokens: 16000 },
  reviewer: { prompt: '08-reviewer', label: '校閲', webSearch: true, required: ['verdict', 'checks'], typicalInputTokens: 22000, expectedOutputTokens: 10000, maxTokens: 32000 },
  xConverter: { prompt: '09-x-converter', label: 'X担当', required: ['posts'], typicalInputTokens: 10000, expectedOutputTokens: 6000, maxTokens: 32000 },
  xPlanner: { prompt: '10-x-planner', label: 'X編成', required: ['assignments'], typicalInputTokens: 5000, expectedOutputTokens: 4000, maxTokens: 16000 },
  analyst: { prompt: '11-analyst', label: 'アナリスト', required: ['winning_patterns', 'genre_decisions'], typicalInputTokens: 12000, expectedOutputTokens: 10000, maxTokens: 32000 },
};

// Web検索を使ってよいのはこの2役だけ
export const WEB_SEARCH_ROLES = Object.keys(ROLES).filter((name) => ROLES[name].webSearch);

// 1回の web_search で文脈に入る検索結果の見込み（サーバー側のループで繰り返し読まれる分も含めた概算）
export const WEB_SEARCH_INPUT_TOKENS = 15000;
