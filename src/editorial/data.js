// AI編集部のサンプルデータ（Google Sheets / Notion 連携前の初期値）

export const concept = {
  position: 'AIを使って、普通の人が収入を作る方法を実験するアカウント',
  axis: 'AI × 副業 × SNS × マーケティング',
  edge: 'SNSマーケ・広告・企業/ビジネス情報の知見を掛け合わせ、単なるAI副業アカウントと差別化',
};

export const loopSteps = [
  { no: '①', title: 'ネタ・需要収集', desc: 'X / Google / note / ニュース / 過去投稿' },
  { no: '②', title: 'note記事生成', desc: 'リサーチ→構成→本文→有料境界→CTA' },
  { no: '③', title: 'Xコンテンツ変換', desc: '1本のnoteから7投稿を生成・予約' },
  { no: '④', title: 'X → note 導線', desc: '無料投稿→プロフィール→無料note→有料' },
  { no: '⑤', title: 'データ収集', desc: 'PV・スキ・購入 / imp・クリック' },
  { no: '⑥', title: '改善・再投資', desc: '勝ちパターンDB → 翌日のネタへ' },
];

export const topics = [
  { name: 'AIでnote運営を自動化して30日の結果', search: 7, xReaction: 9, competition: 4, monetizable: 9, source: 'X反応' },
  { name: 'ChatGPTで広告コピーを量産する手順', search: 8, xReaction: 6, competition: 6, monetizable: 8, source: 'Google' },
  { name: 'X運用で伸びたHook 20選', search: 6, xReaction: 8, competition: 7, monetizable: 6, source: 'X反応' },
  { name: '企業のAI導入ニュースまとめ', search: 5, xReaction: 4, competition: 8, monetizable: 2, source: 'ニュース' },
  { name: '有料noteの価格設定の実験', search: 5, xReaction: 7, competition: 3, monetizable: 8, source: '過去投稿' },
];

export const sampleNote = {
  title: 'AIでnoteを自動化して分かった「本当に時間がかかる工程」',
  hook: '記事を書くAIじゃなく「メディアを運営するAI」を作ると、作業時間は半分以下になる。',
  keyPoints: ['ネタ探し', '競合調査', 'タイトル作り', 'Xへの再利用'],
  result: '開始14日で note 12本・合計 8,400PV・有料 23件購入。',
  url: 'https://note.com/your_account/n/xxxx',
};

// 記事別の実績（⑤データ収集の想定フォーマット）
export const performance = [
  { title: 'AI自動化30日レポート', theme: 'AI自動化', hook: '数字で結果', price: 1480, impressions: 42000, profileVisits: 1900, linkClicks: 820, noteViews: 1300, likes: 140, purchases: 21 },
  { title: 'プロンプト集：note構成', theme: 'AI自動化', hook: '数字で結果', price: 980, impressions: 31000, profileVisits: 1300, linkClicks: 610, noteViews: 950, likes: 98, purchases: 14 },
  { title: '広告コピーAI活用', theme: '広告×AI', hook: '問いかけ', price: 980, impressions: 18000, profileVisits: 600, linkClicks: 190, noteViews: 420, likes: 40, purchases: 4 },
  { title: 'Meta広告の勝ちクリエイティブ', theme: '広告×AI', hook: '逆張り', price: 1480, impressions: 22000, profileVisits: 900, linkClicks: 300, noteViews: 610, likes: 66, purchases: 7 },
  { title: 'X運用のHook分析', theme: 'SNS運用', hook: '逆張り', price: 500, impressions: 26000, profileVisits: 1000, linkClicks: 380, noteViews: 700, likes: 120, purchases: 6 },
  { title: 'フォロワー0からの30日', theme: 'SNS運用', hook: '問いかけ', price: 500, impressions: 15000, profileVisits: 420, linkClicks: 120, noteViews: 300, likes: 35, purchases: 2 },
];

// 収益の階段（①〜④が本体、⑤は副次収益）
export const revenueLadder = [
  { name: '無料note', role: '入口・信頼獲得', core: true },
  { name: '有料note', role: '980〜1,480円の単発販売', core: true },
  { name: 'マガジン / シリーズ', role: '継続課金・まとめ買い', core: true },
  { name: 'アフィリエイト', role: 'AIツール・SaaS紹介', core: true },
  { name: '自社商品', role: 'テンプレ・講座・n8nワークフロー', core: true },
  { name: 'AI学習対価還元', role: 'note側の分配（制御不可の副次収益）', core: false },
];

export const phaseStats = { conceptFixed: true, publishedNotes: 12, patterns: 3, autoDraftApproval: 0.6 };
