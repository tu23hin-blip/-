// 人間が投稿するための完成品一式を output/<日付>_<slug>/ に書き出す
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './store.js';
import { markdownToHtml, splitAtPaywall, stripMarkers, locateMarkers, escapeHtml, markerId, PAYWALL_RE } from './markdown.js';
import { NOTE_URL_PLACEHOLDER, X_LIMIT } from './xtext.js';

const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;
const CATEGORY_LABEL = { value: '単体で役立つ情報', experiment: '実験・結果', opinion: '意見・考察', cta: 'noteへの導線' };
const STATUS_LABEL = { ready: '投稿待ち', needs_review: '要確認' };

function paywallText(price) {
  return `【ここに有料ラインを引く】ここから下が有料エリアです（${yen(price)}）`;
}

export function buildNoteMarkdown({ title, body, images, price }) {
  const byId = Object.fromEntries(images.map((i) => [i.id, i]));
  const lines = body.split('\n').flatMap((line) => {
    const id = markerId(line);
    if (id) return byId[id] ? [`![${id}：${byId[id].alt_text}](${byId[id].file})`] : [];
    if (PAYWALL_RE.test(line)) return price > 0 ? [`> ${paywallText(price)}`] : [];
    return [line];
  });
  return `# ${title}\n\n${lines.join('\n').trim()}\n`;
}

export function buildNoteHtml({ title, body, images, price }) {
  const byId = Object.fromEntries(images.map((i) => [i.id, i]));
  const article = markdownToHtml(body, {
    marker: (id) => (byId[id] ? `<p class="ph">【${id}をここに挿入】${byId[id].file}<br>キャプション：${escapeHtml(byId[id].alt_text)}</p>` : ''),
    paywall: () => (price > 0 ? `<p class="ph pw">${paywallText(price)}</p>` : ''),
  });
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 720px; margin: 32px auto; padding: 0 20px 80px; font-family: "Hiragino Sans", "Noto Sans JP", sans-serif; line-height: 1.9; color: #222; }
  .guide { background: #f4f3fa; border-radius: 10px; padding: 12px 16px; font-size: 14px; color: #555; }
  h1 { font-size: 26px; line-height: 1.5; }
  h2 { font-size: 22px; margin-top: 2em; }
  h3 { font-size: 18px; }
  pre { background: #f6f6f6; padding: 12px 16px; border-radius: 8px; white-space: pre-wrap; }
  .ph { background: #fff4d6; border: 2px dashed #e0a800; border-radius: 8px; padding: 10px 14px; font-weight: bold; }
  .ph.pw { background: #ffe3e3; border-color: #e03131; }
</style>
</head>
<body>
<p class="guide">タイトルはnoteのタイトル欄に別に入力し、下の本文を選択してコピーしてnoteに貼り付けてください。黄色の枠の位置に画像を、赤い枠の位置に有料ラインを入れます（枠の行は消してください）。ダッシュボードの「本文をコピー」を使うと本文だけをコピーできます。</p>
<h1>${escapeHtml(title)}</h1>
<article id="note-body">
${article}
</article>
</body>
</html>
`;
}

export function buildXMarkdown({ title, x }) {
  const blocks = x.posts.map((p, i) => {
    const warn = p.warnings.length ? `\n${p.warnings.map((w) => `> ⚠ ${w}`).join('\n')}\n` : '';
    return `## ${i + 1}. ${p.recommended_label}｜${p.label}（${p.id}）\n\nカテゴリ：${CATEGORY_LABEL[p.category] || p.category}　フック：${p.hook_type || '-'}　文字数：${p.x_length}/${X_LIMIT}\n${warn}\n\`\`\`text\n${p.text}\n\`\`\`\n`;
  });
  return `# X投稿：${title}\n\n- noteの公開推奨：${x.note_publish_label}\n- 自動投稿はしません。内容を確認してから、Xの予約投稿などで1本ずつ設定してください。\n- ${NOTE_URL_PLACEHOLDER} は、公開したnoteのURLに置き換えてください。\n${x.notes ? `- 編成メモ：${x.notes}\n` : ''}\n${blocks.join('\n')}`;
}

export function buildChecklist({ meta, x }) {
  const lines = [`# 投稿チェックリスト：${meta.title}`, ''];
  if (meta.review.final_status === 'needs_review') {
    lines.push('> ⚠ **要確認**：校閲で合格しませんでした。下の「確認すること」を読んで、直すか公開をやめるかを判断してください。', '');
  }
  lines.push(`- ジャンル：${meta.genre.name}（${meta.genre.genre_id}）`, `- 価格：${meta.price_yen > 0 ? yen(meta.price_yen) : '無料'}`, `- 校閲：${STATUS_LABEL[meta.review.final_status]}（スコア ${meta.review.quality_score ?? '不明'}・${meta.review.rounds}回目で判定）`, '');

  const checks = [meta.review.notes_for_human, ...(meta.review.final_status === 'needs_review' ? meta.review.issues.map((i) => `[${i.check}] ${i.location ? `${i.location}：` : ''}${i.problem}`) : []), ...meta.warnings].filter(Boolean);
  lines.push('## 確認すること', '', ...(checks.length ? checks.map((c) => `- ${c}`) : ['- 特になし']), '');

  let n = 0;
  const step = (text) => `- [ ] ${(n += 1)}. ${text}`;
  lines.push('## noteに投稿する', '');
  lines.push(step('noteで「投稿」→「テキスト」を開く'));
  lines.push(step(`タイトルに「${meta.title}」を入力する`));
  lines.push(step('本文を貼り付ける（ダッシュボードの「本文をコピー」を押して貼り付け。または note_body.html をブラウザで開いてコピー）'));
  if (meta.images.length) {
    lines.push(step('図解を入れる：黄色の【図N】の行を消し、その位置に画像を挿入して、キャプションに説明文を入れる'), '');
    lines.push('  | 図 | 画像 | 入れる位置 | キャプション |', '  | --- | --- | --- | --- |');
    meta.images.forEach((img) => lines.push(`  | ${img.id} | ${img.file} | 見出し「${img.position?.heading || '-'}」の「${img.position?.after || '（見出しの直後）'}」の後 | ${img.alt_text} |`));
    lines.push('');
  }
  if (meta.price_yen > 0) {
    lines.push(step(`有料ラインを引く：見出し「${meta.paywall?.heading || '-'}」の「${meta.paywall?.after || '-'}」の後（赤い【ここに有料ラインを引く】の行を消して、そこに設定）`));
    lines.push(step(`価格を ${yen(meta.price_yen)} に設定する`));
  } else {
    lines.push(step('無料記事として公開する（有料ラインは不要）'));
  }
  lines.push(step('アイキャッチに eyecatch.png を設定する'));
  if (meta.hashtags.length) lines.push(step(`ハッシュタグを入れる：${meta.hashtags.join(' ')}`));
  if (meta.magazine) lines.push(step(`マガジン「${meta.magazine}」に追加する`));
  lines.push(step(`${x ? `${x.note_publish_label} ごろに` : ''}公開し、URLをダッシュボードの「noteのURL」に入力する`), '');

  lines.push('## Xに投稿する', '');
  if (!x) {
    lines.push('- X投稿は作れませんでした（「確認すること」を参照）', '');
  } else {
    lines.push('自動投稿はしません。内容を確認して、Xの予約投稿で1本ずつ設定してください（本文は x_posts.md かダッシュボードからコピー）。', '');
    lines.push('| 日時 | 種類 | ID |', '| --- | --- | --- |');
    x.posts.forEach((p) => lines.push(`| ${p.recommended_label} | ${p.label} | ${p.id} |`));
    lines.push('', `- [ ] 誘導投稿の ${NOTE_URL_PLACEHOLDER} を公開したnoteのURLに置き換える（ダッシュボードでnoteのURLを入力すると、コピー時に自動で置き換わります）`);
    lines.push('- [ ] 予約した順に投稿されたら、ポストのURLをダッシュボードの「投稿済みにする」に入力する', '');
  }
  return `${lines.join('\n')}\n`;
}

const freeRatio = (body) => {
  const { free, paid } = splitAtPaywall(body);
  const f = stripMarkers(free).length;
  const p = stripMarkers(paid).length;
  return f + p ? Math.round((f / (f + p)) * 100) / 100 : 1;
};

export function writePackage(outDir, data) {
  const { title, body, images, price } = data;
  const positions = locateMarkers(body);
  const meta = {
    version: 1,
    slug: data.slug,
    created_at: data.createdAt,
    demo: data.demo,
    genre: { genre_id: data.genre.genre_id, name: data.genre.name, status: data.genre.status },
    title,
    title_candidates: data.outline.title_candidates || [],
    lead: data.outline.lead || '',
    price_yen: price,
    hashtags: data.outline.hashtags.map((t) => `#${t}`),
    magazine: data.genre.magazine || null,
    paywall: price > 0 && positions.paywall ? { ...positions.paywall, free_ratio: freeRatio(body) } : null,
    images: images.map((img) => ({ ...img, position: positions.markers[img.id] || null })),
    eyecatch: data.eyecatch,
    review: {
      final_status: data.review.finalStatus,
      verdict: data.review.decision.verdict,
      quality_score: data.review.decision.quality_score,
      rounds: data.review.rounds.length,
      checks: data.review.review?.checks || {},
      issues: data.review.decision.issues,
      reasons: data.review.decision.reasons,
      notes_for_human: data.review.review?.notes_for_human || '',
      history: data.review.rounds,
    },
    idea: data.idea,
    x: data.x ? { file: 'x_posts.json', count: data.x.posts.length, note_publish_at: data.x.note_publish_at, planner: data.x.planner } : null,
    warnings: data.warnings,
    cost: data.cost,
    models: data.models,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'note_body.md'), buildNoteMarkdown({ title, body, images, price }));
  fs.writeFileSync(path.join(outDir, 'note_body.html'), buildNoteHtml({ title, body, images, price }));
  if (data.x) {
    writeJsonAtomic(path.join(outDir, 'x_posts.json'), { title, note_publish_at: data.x.note_publish_at, note_publish_label: data.x.note_publish_label, planner: data.x.planner, notes: data.x.notes, posts: data.x.posts });
    fs.writeFileSync(path.join(outDir, 'x_posts.md'), buildXMarkdown({ title, x: data.x }));
  }
  fs.writeFileSync(path.join(outDir, 'publish_checklist.md'), buildChecklist({ meta, x: data.x }));
  writeJsonAtomic(path.join(outDir, 'meta.json'), meta);
  return meta;
}

