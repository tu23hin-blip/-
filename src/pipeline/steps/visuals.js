// ⑦ 図解のPNG化と ⑧ アイキャッチ。テンプレートで描けない図は、AIに自己完結HTMLを書かせて描く
import fs from 'node:fs';
import path from 'node:path';
import { CostLimitError, LLMOutputError } from '../errors.js';
import { diagramNumber } from '../markdown.js';
import { charLength, salvageDiagram } from '../render/diagramSpec.js';
import { iconSvg } from '../render/icons.js';
import { generateBackground } from '../render/background.js';

export const imageFile = (id) => `images/${String(diagramNumber(id)).padStart(2, '0')}.png`;

// 失敗しても記事全体は止めない工程（費用上限・出力の読み取り失敗は注意事項として残す）
async function softly(ctx, label, fn, fallback = null) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof CostLimitError || e instanceof LLMOutputError)) throw e;
    ctx.log(`   ⚠ ${label}：${e.message}`);
    ctx.warnings.push(`${label}：${e.message}`);
    return fallback;
  }
}

async function requestCustomHtml(ctx, { id, title, purpose, body }) {
  const out = await ctx.llm.run(
    'diagrammer',
    { body_markdown: body, diagram_specs: [{ id, type: 'custom', purpose: purpose || title }], brand_colors: ctx.colors },
    { extraInstruction: `${id}「${title || purpose}」は固定テンプレートで描けませんでした。type を "custom" にし、custom_html に 1280×720 の自己完結HTML（外部読み込みなし・<script>なし・フォントは "Noto Sans JP"）を書いてください。diagrams にはこの1枚だけを入れてください。` },
  );
  const d = (out.diagrams || [])[0] || {};
  return typeof d.custom_html === 'string' && d.custom_html.trim() ? { html: d.custom_html, alt: d.alt_text } : null;
}

export async function renderDiagrams(ctx, { diagrams, missing, specs, body }) {
  fs.mkdirSync(path.join(ctx.outDir, 'images'), { recursive: true });
  const jobs = [
    ...diagrams.map((d) => ({ ...d })),
    ...missing.map((id) => {
      const spec = specs.find((s) => s.id === id) || {};
      return { id, type: 'custom', title: spec.purpose || id, alt_text: spec.purpose || id, custom_html: null, schema_error: '図解のJSONがありません', purpose: spec.purpose };
    }),
  ].sort((a, b) => diagramNumber(a.id) - diagramNumber(b.id));

  const results = [];
  for (const d of jobs) {
    const file = imageFile(d.id);
    const outPath = path.join(ctx.outDir, file);
    const warnings = [];
    let mode = 'template';
    let overflow = [];
    let alt = d.alt_text;
    // 描画の失敗で記事全体を止めないよう、テンプレート → AIのHTML → 簡易図 の順に試す
    const attempt = async (label, fn) => {
      try {
        return await fn();
      } catch (e) {
        ctx.log(`   ⚠ ${d.id} を${label}で描けませんでした（${e.message.split('\n')[0]}）`);
        return null;
      }
    };
    let done = false;
    if (d.type !== 'custom' && !d.schema_error) {
      const r = await attempt('テンプレート', () => ctx.renderer.renderDiagram(d, { colors: ctx.colors, brand: ctx.brand, outPath }));
      if (r) ({ overflow } = r);
      done = Boolean(r);
    } else {
      let custom = d.type === 'custom' && d.custom_html ? { html: d.custom_html } : null;
      if (!custom) {
        ctx.log(`   ⚠ ${d.id} はテンプレートで描けません（${d.schema_error || 'custom'}）→ HTMLを書いてもらいます`);
        custom = await softly(ctx, `${d.id} のHTML作成`, () => requestCustomHtml(ctx, { id: d.id, title: d.title, purpose: d.purpose, body }));
      }
      if (custom && (await attempt('HTML', () => ctx.renderer.renderCustom(custom.html, { outPath })))) {
        mode = 'custom';
        alt = alt || custom.alt;
        warnings.push('テンプレート外の図（AIが書いたHTML）です。文字が崩れていないか確認してください');
        done = true;
      }
    }
    if (!done) {
      mode = 'salvaged';
      ({ overflow } = await ctx.renderer.renderDiagram(salvageDiagram(d), { colors: ctx.colors, brand: ctx.brand, outPath }));
      warnings.push('図解の中身を作れなかったため、簡易的な図にしました。差し替えを検討してください');
    }
    if (overflow.length) warnings.push(`文字が枠に収まっていない可能性があります：${overflow.join(' / ')}`);
    warnings.forEach((w) => ctx.warnings.push(`${d.id}：${w}`));
    ctx.log(`   ✓ ${file}  ${d.id}「${d.title || ''}」（${{ template: d.type, custom: 'カスタムHTML', salvaged: '簡易図' }[mode]}）`);
    results.push({ id: d.id, file, type: mode === 'template' ? d.type : mode === 'custom' ? 'custom' : 'steps', title: d.title, alt_text: alt || d.title || d.id, mode, warnings });
  }
  return results;
}

export const EYECATCH_LAYOUTS = ['center_bold', 'left_text_right_icon', 'before_after_split'];

export function eyecatchProblems(spec) {
  const problems = [];
  if (!String(spec.main_copy || '').trim()) problems.push('main_copy が空です');
  if (charLength(spec.main_copy) > 13) problems.push(`main_copy「${spec.main_copy}」が${charLength(spec.main_copy)}文字です（13文字以内）`);
  if (charLength(spec.sub_copy) > 20) problems.push(`sub_copy「${spec.sub_copy}」が${charLength(spec.sub_copy)}文字です（20文字以内）`);
  if (!EYECATCH_LAYOUTS.includes(spec.layout)) problems.push(`layout「${spec.layout}」は使えません（${EYECATCH_LAYOUTS.join(' / ')}）`);
  return problems;
}

export async function makeEyecatch(ctx, { title, lead }) {
  const vars = { title, lead, brand_colors: ctx.colors, winning_eyecatch_patterns: ctx.patterns.eyecatch_patterns || [] };
  let spec = await ctx.llm.run('eyecatch', vars);
  let problems = eyecatchProblems(spec);
  if (problems.length) {
    ctx.log(`   ⚠ アイキャッチのルール違反 → 1回だけ直してもらいます`);
    spec = await ctx.llm.run('eyecatch', vars, { extraInstruction: `前回の出力に次の問題がありました。直して出力し直してください。\n${problems.map((p) => `- ${p}`).join('\n')}` });
    problems = eyecatchProblems(spec);
  }
  const layout = EYECATCH_LAYOUTS.includes(spec.layout) ? spec.layout : 'center_bold';
  const clean = { layout, main_copy: String(spec.main_copy || title).trim(), sub_copy: String(spec.sub_copy || '').trim(), badge: String(spec.badge || '').trim(), icon_keyword: String(spec.icon_keyword || '').trim() };
  const background = spec.background_prompt ? await generateBackground({ config: ctx.config, prompt: spec.background_prompt, cost: ctx.cost, log: ctx.log }) : null;
  const { overflow } = await ctx.renderer.renderEyecatch(clean, { colors: ctx.colors, brand: ctx.brand, iconSvg: iconSvg(clean.icon_keyword), background, outPath: path.join(ctx.outDir, 'eyecatch.png') });
  const warnings = [...problems, ...overflow.map((o) => `文字が枠に収まっていない可能性があります：${o}`)];
  warnings.forEach((w) => ctx.warnings.push(`アイキャッチ：${w}`));
  ctx.log(`   ✓ eyecatch.png  「${clean.main_copy}」（${layout}${background ? '・背景画像あり' : ''}）`);
  return { ...clean, file: 'eyecatch.png', background: background ? 'generated' : 'none', background_prompt: spec.background_prompt || null, warnings };
}

export { softly };
