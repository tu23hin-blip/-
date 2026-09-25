// デモ・テスト用の固定の応答（LLM_PROVIDER=mock / npm run demo）。数値はすべてデモ用の架空の値。
import { assignPostsToSlots } from '../../editorial/engine.js';

const asObject = (v) => (v && typeof v === 'object' ? v : null);

export const DEMO_BODY = `note記事に図解を入れたいのに、作る時間がない。画像生成AIに頼むと、日本語の文字がにじんだり別の字に化けたりする。
この記事は、そんな悩みを持つnote書きの方に向けて、**図解の「中身」だけをAIに考えさせ、描画はテンプレートに任せる**方法を紹介します。
読み終えるころには、記事1本分の図解を、崩れない日本語でまとめて作れるようになります。

## 図解の文字が崩れるのは「文字まで描かせている」から

画像生成AIは、絵を描くのは得意です。一方で、画像の中の文字を正確に書くのは苦手です。
特に日本語はひらがな・カタカナ・漢字が混ざるため、1文字ずつ形が崩れやすくなります。

[図1]

原因はAIの性能というより、役割分担にあります。
「何を載せるか」と「どう描くか」を1つのAIに同時に任せているので、文字の正確さが犠牲になるのです。

## 解決策は「中身はAI、描画はテンプレート」の分業

考え方はシンプルです。AIには図解の中身だけを、決まった形のデータ（JSON）で書いてもらいます。
文字の描画は、あらかじめ用意したHTMLテンプレートとフォントが行います。

[図2]

この分け方には、3つの利点があります。

- 文字が崩れない（フォントで描くため）
- 配色やレイアウトがそろい、ブランドの統一感が出る
- 中身だけ差し替えれば、何枚でも同じ品質で作れる

## 実際にやってみた結果（デモ用の架空データ）

※ここに書く数値は、このデモのために用意した架空の例です。

図解を手作業で作っていたときは、1枚あたり20分ほどかかっていました。
分業に切り替えたあとは、AIの出力を確認して書き出すだけになり、1枚あたり3分ほどで済みました。

**この先の有料部分では、そのまま使える次の3つを紹介します。**

- 図解の中身をJSONで出させるプロンプト全文
- 7種類のテンプレートの使い分け表
- 公開前に見る図解チェックリスト

<<<PAYWALL>>>

## 図解の中身をJSONで出させるプロンプト

次のプロンプトを、記事本文と一緒にAIへ渡します。出力されたJSONをテンプレートに流し込めば、図解が完成します。

\`\`\`
あなたは図解デザイナーです。次の本文から図解を1枚作ります。
- 1枚で伝えることは1つだけ
- 1要素は20文字以内、要素は最大7つ
- タイトルは18文字以内
- 本文にない数字は使わない
出力はJSONだけにしてください。
{ "type": "flow", "title": "", "items": [{ "label": "", "sub": "" }] }
\`\`\`

### うまくいかないときの直し方

- 文字があふれる場合は「1要素15文字以内」に厳しくする
- 図の種類が合わない場合は、type を指定して出し直す

## 7種類のテンプレートの使い分け

図解の種類は、伝えたい内容で選びます。迷ったら下の表で決めてください。

[図3]

## 公開前の図解チェックリスト

最後に、公開前に次の項目を確認します。

[図4]

## まとめ

図解づくりの時間を減らすコツは、AIに全部を任せないことです。
中身はAI、描画はテンプレートと分けるだけで、日本語が崩れない図解を安定して作れます。
マガジン「AI編集部 実験ログ」では、ほかの自動化の実験も記録しています。`;

export const DEMO_DIAGRAMS = [
  {
    id: '図1', type: 'before_after', title: '文字が崩れる原因と対策', subtitle: '役割を分けるだけで変わる',
    items: { before_label: 'よくある作り方', after_label: '分業した作り方', before: ['AIに文字まで描かせる', '日本語がにじむ・化ける', '1枚ずつ手直しが必要'], after: ['中身だけAIが決める', '文字はフォントで描画', '何枚でも同じ品質'] },
    footer: '', alt_text: '画像生成AIに文字まで描かせる作り方と、中身だけAIに決めさせる作り方の比較', custom_html: null,
  },
  {
    id: '図2', type: 'flow', title: '図解ができるまでの流れ', subtitle: '',
    items: [
      { label: '記事の本文', sub: '図にする位置を決める' },
      { label: 'AIが中身を決める', sub: 'JSONで出力', highlight: true },
      { label: 'テンプレートに流し込む', sub: '配色はジャンル別' },
      { label: 'PNGで書き出す', sub: '1280×720' },
    ],
    footer: '', alt_text: '本文から図解ができるまでの4つの工程', custom_html: null,
  },
  {
    id: '図3', type: 'compare', title: 'テンプレートの使い分け', subtitle: '',
    items: {
      columns: ['向いている内容', '記事での例'],
      rows: [
        { label: '手順フロー', values: ['作業の流れ', '全体像の説明'] },
        { label: 'ステップ', values: ['番号付きの手順', '設定の手順'] },
        { label: '比較表', values: ['2つ以上の比較', 'ツールの比較'] },
        { label: 'チェックリスト', values: ['確認項目', '公開前の確認'] },
        { label: 'ビフォーアフター', values: ['変化の説明', '導入の前後'] },
        { label: '棒グラフ', values: ['数値の比較', '作業時間'] },
        { label: 'マトリクス', values: ['2軸での整理', '優先順位'] },
      ],
    },
    footer: '', alt_text: '7種類の図解テンプレートと、それぞれに向いている内容の一覧', custom_html: null,
  },
  {
    id: '図4', type: 'checklist', title: '公開前の図解チェック', subtitle: '',
    items: [
      { label: '1枚で伝えることは1つ', checked: true },
      { label: '1要素は20文字以内', checked: true },
      { label: '本文と数字が一致している', checked: true },
      { label: '強調は1〜2か所まで', checked: true },
      { label: 'スマホで文字が読める', checked: true },
      { label: '出典を書いた', checked: false },
    ],
    footer: '', alt_text: '公開前に確認する6つのチェック項目', custom_html: null,
  },
];

export const DEMO_POSTS = [
  { id: 'short-1', type: 'short', category: 'value', hook_type: '逆張り', source_heading: '図解の文字が崩れるのは「文字まで描かせている」から',
    text: '図解をAIに作らせると日本語が崩れる。\nこれはAIの性能より、役割分担の問題です。\n\n「何を載せるか」はAI、「どう描くか」はテンプレート。\nこう分けるだけで、文字化けはなくなります。' },
  { id: 'short-2', type: 'short', category: 'value', hook_type: 'ハウツー', source_heading: '図解の中身をJSONで出させるプロンプト',
    text: '図解の文字は「1要素20文字まで」が目安です。\nスマホで無理なく読めるのは、これくらいの量。\n長くなったら、図を2枚に分けた方が伝わります。' },
  { id: 'short-3', type: 'short', category: 'opinion', hook_type: '問いかけ', source_heading: 'まとめ',
    text: 'note記事の図解、何枚入れていますか？\n文章だけでは伝わりにくい所にだけ入れる。2〜5枚で十分です。\n全部の見出しに図を入れると、かえって読みにくくなります。' },
  { id: 'knowhow-1', type: 'knowhow', category: 'value', hook_type: 'ハウツー', source_heading: '解決策は「中身はAI、描画はテンプレート」の分業',
    text: '崩れない図解を作る手順\n\n1. 本文の中で図にしたい所を決める\n2. AIに中身だけJSONで書かせる\n3. HTMLテンプレートに流し込む\n4. PNGで書き出す\n\n文字はフォントで描くので、にじみません。' },
  { id: 'knowhow-2', type: 'knowhow', category: 'value', hook_type: '体験談', source_heading: '公開前の図解チェックリスト',
    text: '図解づくりでよくある失敗\n\n× 1枚に情報を詰め込む\n× 強調を5か所以上つける\n× 本文と違う数字を載せる\n\n強調は1〜2か所まで、数字は本文と同じものだけ。これで見やすさが変わります。' },
  { id: 'long-1', type: 'long', category: 'experiment', hook_type: '数字で結果', source_heading: '実際にやってみた結果（デモ用の架空データ）',
    text: '【実験メモ（デモ用の架空データ）】図解づくりを分業にしてみた\n\n手作業：1枚あたり約20分\n分業後：1枚あたり約3分\n\nやったことは2つだけです。\n1. AIには図解の中身をJSONで出させる\n2. 描画はHTMLテンプレートとフォントに任せる\n\n画像生成AIに文字まで描かせると、日本語がにじんだり別の字に化けたりします。役割を分けると、文字は必ず正しく描かれます。\n配色もテンプレート側でそろうので、記事ごとの統一感も出ました。' },
  { id: 'cta-1', type: 'cta', category: 'cta', hook_type: 'ハウツー', source_heading: 'まとめ',
    text: '図解の文字崩れをなくす方法をnoteにまとめました。\n\n無料部分：崩れる原因と、分業の考え方\n有料部分：JSONで中身を出させるプロンプト全文、7種類のテンプレートの使い分け表、公開前チェックリスト\n\n[noteのURL]' },
];

function pickGenre(vars) {
  const g = asObject(vars.genre);
  if (g?.genre_id) return g.genre_id;
  const list = Array.isArray(vars.genres_json) ? vars.genres_json : [];
  return (list.find((x) => x.status === 'active') || list[0] || { genre_id: 'ai-note-automation' }).genre_id;
}

export const FIXTURES = {
  genreScout: () => ({
    candidates: [
      {
        genre_id: 'ai-sns-ops', name: 'AIでSNS運用を時短する実験', target_reader: '本業の合間にSNS発信を続けたい会社員。投稿づくりに毎日1時間かかっている',
        why_pay: '投稿づくりの時間が減り、発信を続けられる', experiment_angle: 'AIで1週間分の投稿を作り、反応と所要時間を記録する',
        paid_assets: ['投稿テンプレ10種', '1週間分をまとめて作るプロンプト', '反応の記録シート'],
        sample_titles: ['SNS投稿を1週間分まとめてAIで作る手順', 'AIに書かせたX投稿、伸びた型と伸びない型', '毎日投稿を30分で終わらせる仕組み'],
        sample_x_hooks: ['毎日投稿がつらい人へ。', 'AIに投稿を書かせて分かったこと。', '伸びる投稿は「型」で作れる。'],
        risk: '同ジャンルの発信者が多い。自動投稿と誤解されないよう手動投稿を明記する', needs_separate_account: false,
        test_plan: { x_posts: 10, free_notes: 2, paid_notes: 1, days: 14 },
        success_criteria: { note_pv: 800, x_profile_clicks: 150, paid_sales: 3, is_provisional: true }, priority: 1,
      },
      {
        genre_id: 'ai-small-shop', name: '小さなお店のAI集客', target_reader: '個人経営の飲食店・美容室のオーナー。集客の文章を書く時間がない',
        why_pay: '集客文の作成を任せられ、来店につながる', experiment_angle: '協力店舗でAIが作った告知文の反応を比べる',
        paid_assets: ['業種別の告知文テンプレ', 'Googleマップの口コミ返信テンプレ'],
        sample_titles: ['個人店の告知文をAIで作る手順', '口コミ返信をAIに任せる方法', '週1回30分で回すお店のSNS'],
        sample_x_hooks: ['お店の告知文、AIで作れます。', '口コミ返信で差がつく。', '個人店こそAIを使うべき理由。'],
        risk: '読者層がAI副業の世界観と異なる', needs_separate_account: true,
        test_plan: { x_posts: 10, free_notes: 2, paid_notes: 1, days: 14 },
        success_criteria: { note_pv: 500, x_profile_clicks: 80, paid_sales: 2, is_provisional: true }, priority: 2,
      },
    ],
  }),

  editorInChief: ({ vars, flags }) => {
    const genre_id = pickGenre(vars);
    const low = flags.has('no_idea');
    return {
      ideas: [
        {
          genre_id, topic: 'noteの図解づくりをAIに任せる手順', angle: '画像生成AIに文字を描かせず「中身はAI・描画はテンプレート」に分ける',
          reader_problem: '図解を作る時間がない。AI画像だと日本語が崩れる', promise: '記事1本分の図解を、崩れない日本語でまとめて作れる',
          scores: low ? { search_demand: 20, x_reaction: 25, low_competition: 30, monetizability: 20 } : { search_demand: 72, x_reaction: 85, low_competition: 70, monetizability: 88 },
          score_reasons: '（デモ）図解の文字崩れはAIユーザーの共通の悩み。テンプレとプロンプトを有料部分にできる',
          used_patterns: ['テンプレ同梱は売れやすい'], article_type: 'howto', suggested_price_yen: 980,
          research_questions: ['画像生成AIが文字を苦手とする理由', 'noteの画像の推奨サイズ', '図解に向く情報量の目安'],
        },
        {
          genre_id, topic: 'AIに書かせたX投稿の伸びた型', angle: '30本の投稿を型ごとに比べる',
          reader_problem: 'AIで投稿を作っても伸びない', promise: '伸びる型が分かる',
          scores: { search_demand: 45, x_reaction: 60, low_competition: 40, monetizability: 50 },
          score_reasons: '（デモ）反応は見込めるが、有料化しにくい', used_patterns: [], article_type: 'experiment_report', suggested_price_yen: 500,
          research_questions: [],
        },
        {
          genre_id, topic: 'AIニュースまとめ', angle: '今週の発表を要約',
          reader_problem: '情報が多すぎる', promise: '5分で追いつける',
          scores: { search_demand: 40, x_reaction: 30, low_competition: 10, monetizability: 10 },
          score_reasons: '（デモ）競合が多く有料化しにくい', used_patterns: [], article_type: 'opinion', suggested_price_yen: 0, research_questions: [],
        },
      ],
    };
  },

  researcher: () => ({
    facts: [
      { claim: '（デモ）画像生成AIは、画像内の文字、とくに日本語を正確に描けないことがある', source_title: 'デモ用のサンプル出典', source_url: 'https://example.com/demo/image-text', checked_at: '2026-09-01', reliability: 'medium' },
      { claim: '（デモ）Webフォントで描いた文字は、拡大しても形が崩れない', source_title: 'デモ用のサンプル出典', source_url: 'https://example.com/demo/web-font', checked_at: '2026-09-01', reliability: 'high' },
      { claim: '（デモ）スマホで読める図解の文字量は、1要素20文字程度が目安', source_title: 'デモ用のサンプル出典', source_url: 'https://example.com/demo/mobile', checked_at: '2026-09-01', reliability: 'low' },
    ],
    steps_or_methods: ['AIに図解の中身をJSONで出力させる', 'HTMLテンプレートに流し込んで画像にする'],
    tools: [{ name: 'Playwright', what_for: 'HTMLを画像として書き出す', pricing_note: '無料（オープンソース）', source_url: 'https://playwright.dev/' }],
    competitor_gaps: ['「なぜ崩れるか」の説明がない記事が多い', 'テンプレートの使い分けまで書いた記事は少ない'],
    first_party_highlights: ['（デモ）1枚あたりの作成時間が約20分から約3分に短縮'],
    not_found: ['画像生成AIの日本語描画の正確さを比べた公式データ'],
    cautions: ['フォントのライセンスを確認する（Noto Sans JP は OFL）'],
  }),

  outliner: () => ({
    title_candidates: ['noteの図解をAIで作っても文字が崩れない方法', '図解づくりは「中身はAI・描画はテンプレ」で速くなる', 'AI図解の日本語が崩れる理由と直し方', '図解1枚3分：AIとテンプレの分業術', 'note図解を量産する前に決めるべきこと'],
    lead: '図解を作る時間がない・AI画像だと日本語が崩れる、という悩みに対して、中身と描画を分ける方法を示す',
    sections: [
      { heading: '図解の文字が崩れるのは「文字まで描かせている」から', part: 'free', points: ['画像生成AIは文字が苦手', '役割分担の問題'], facts_to_use: ['（デモ）画像生成AIは、画像内の文字、とくに日本語を正確に描けないことがある'], diagram: { id: '図1', type: 'before_after', purpose: '作り方の違いで結果が変わることを見せる' } },
      { heading: '解決策は「中身はAI、描画はテンプレート」の分業', part: 'free', points: ['JSONで中身を出す', 'テンプレートで描く'], facts_to_use: [], diagram: { id: '図2', type: 'flow', purpose: '図解ができるまでの流れ' } },
      { heading: '実際にやってみた結果（デモ用の架空データ）', part: 'free', points: ['作成時間の変化'], facts_to_use: [], diagram: null },
      { heading: '図解の中身をJSONで出させるプロンプト', part: 'paid', points: ['プロンプト全文', '直し方'], facts_to_use: [], diagram: null },
      { heading: '7種類のテンプレートの使い分け', part: 'paid', points: ['用途別の選び方'], facts_to_use: [], diagram: { id: '図3', type: 'compare', purpose: 'テンプレートの選び方' } },
      { heading: '公開前の図解チェックリスト', part: 'paid', points: ['確認項目'], facts_to_use: [], diagram: { id: '図4', type: 'checklist', purpose: '公開前の確認' } },
      { heading: 'まとめ', part: 'paid', points: ['分業のすすめ'], facts_to_use: [], diagram: null },
    ],
    paid_preview: 'JSONで中身を出させるプロンプト全文、7種類のテンプレートの使い分け表、公開前チェックリスト',
    price_yen: 980,
    cta: 'マガジン「AI編集部 実験ログ」への誘導',
    hashtags: ['AI活用', '図解', 'note書き方', '生成AI', '業務効率化'],
  }),

  writer: ({ vars }) => {
    const revising = typeof vars.review_feedback === 'string' && !vars.review_feedback.startsWith('なし');
    return {
      title: 'noteの図解をAIで作っても文字が崩れない方法',
      body_markdown: DEMO_BODY,
      word_count: DEMO_BODY.length,
      used_fact_ids: ['F1', 'F2'],
      changes: revising ? ['校閲の指摘に合わせて表現を修正しました（デモ）'] : [],
    };
  },

  diagrammer: ({ flags, n }) => {
    const diagrams = structuredClone(DEMO_DIAGRAMS);
    if (flags.has('long_labels_once') && n === 1) diagrams[1].items[0].label = '記事の本文を読み込んで、図にしたい場所をすべて洗い出す';
    return { diagrams };
  },

  eyecatch: () => ({
    layout: 'center_bold', main_copy: '図解の文字崩れ、0に', sub_copy: '中身はAI・描画はテンプレ', badge: '保存版', icon_keyword: '画像', background_prompt: null,
  }),

  reviewer: ({ flags, n }) => {
    const fail = flags.has('always_revise') || (flags.has('revise_once') && n === 1);
    const human = flags.has('human_review');
    const checks = { fact: 'pass', no_hallucination: 'pass', paid_value: 'pass', free_value: 'pass', originality: 'pass', readability: 'pass', ai_smell: 'pass', claims: 'pass', compliance: 'pass', diagrams: 'pass', structure: 'pass' };
    if (fail) Object.assign(checks, { readability: 'fail', ai_smell: 'fail' });
    if (human) checks.claims = 'fail';
    return {
      verdict: human ? 'human_review' : fail ? 'revise' : 'pass',
      checks,
      issues: fail ? [{ check: 'readability', location: '導入', problem: '（デモ）1文が長い', fix: '2文に分ける' }] : human ? [{ check: 'claims', location: '結果', problem: '（デモ）数字の根拠が弱い', fix: '人間が確認する' }] : [],
      quality_score: fail ? 62 : 86,
      notes_for_human: 'デモ用の架空データを含む記事です。実際の投稿には使わないでください。',
    };
  },

  xConverter: ({ flags, n }) => {
    const posts = structuredClone(DEMO_POSTS);
    if (flags.has('dup_posts_once') && n === 1) posts[1].text = posts[0].text.replace('崩れる。', '崩れます。');
    return { posts };
  },

  xPlanner: ({ vars, flags }) => {
    const posts = Array.isArray(vars.posts_json) ? vars.posts_json : [];
    const slots = Array.isArray(vars.slots_json) ? vars.slots_json : [];
    if (flags.has('bad_plan')) return { assignments: posts.map((p) => ({ post_id: p.id, slot_id: slots[0]?.slot_id, reason: 'デモ' })), notes: '' };
    const { assignments } = assignPostsToSlots(posts, slots, { notePublishAt: String(vars.note_publish_at || '').replace('T', ' ').slice(0, 16) });
    return { assignments: assignments.map((a) => ({ ...a, reason: '（デモ）カテゴリと曜日のバランスで選びました' })), notes: '（デモ）1日1本ずつ、1週間に散らしています' };
  },

  analyst: ({ vars }) => {
    const stats = Array.isArray(vars.genre_stats) ? vars.genre_stats : [];
    return {
      summary: '（デモ）テンプレ同梱の記事が好調。testing ジャンルは判定材料が不足。',
      winning_patterns: [
        { dimension: 'article_type', value: 'howto', text: '「howto」タイプの記事が売れる', evidence: '（デモ）PVあたり売上が平均比 +30%', confidence: 'medium' },
        { dimension: 'eyecatch', value: 'center_bold', text: 'アイキャッチは中央に大きく数字を置く', evidence: '（デモ）クリック率が高い', confidence: 'low' },
      ],
      retire_patterns: [],
      genre_decisions: stats.map((g) => ({
        genre_id: g.genre_id,
        decision: g.status === 'testing' && g.test_ended ? (g.meets_criteria ? 'promote' : 'retire') : 'continue',
        reason: '（デモ）成功基準との比較による判定',
        lesson: g.status === 'testing' && g.test_ended && !g.meets_criteria ? '（デモ）読者の悩みが浅く、有料部分の価値を示せなかった' : '',
      })),
      x_mix: { value: 0.5, experiment: 0.2, opinion: 0.2, cta: 0.1, reason: '（デモ）変更なし' },
      next_week_experiments: [{ hypothesis: '（デモ）価格を1,480円にしても購入率は落ちない', change: '価格だけを変える', success_metric: '購入率が平均の9割以上' }],
    };
  },
};
