// docs/ai-editorial-prompts.md（章ごとのプロンプト集）⇔ prompts/*.md の分割と、{{変数}} の差し込み
import fs from 'node:fs';
import path from 'node:path';

// <!-- prompt:01-genre-scout --> の直後にある ~~~~markdown ... ~~~~ ブロックを1章として取り出す
export function splitPromptDoc(text) {
  const re = /<!--\s*prompt:([a-z0-9-]+)\s*-->[\s\S]*?^~~~~markdown\n([\s\S]*?)^~~~~$/gm;
  return [...text.matchAll(re)].map((m) => ({ id: m[1], text: m[2].replace(/\n+$/, '') + '\n' }));
}

export function syncPrompts({ docPath, promptsDir }) {
  const chapters = splitPromptDoc(fs.readFileSync(docPath, 'utf8'));
  fs.mkdirSync(promptsDir, { recursive: true });
  const written = [];
  for (const { id, text } of chapters) {
    const file = path.join(promptsDir, `${id}.md`);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      fs.writeFileSync(file, text);
      written.push(file);
    }
  }
  const known = new Set(chapters.map((c) => `${c.id}.md`));
  const unknown = fs.readdirSync(promptsDir).filter((f) => /^\d{2}-.+\.md$/.test(f) && !known.has(f));
  return { chapters: chapters.map((c) => c.id), written, unknown };
}

export function loadPrompt(id, promptsDir) {
  const file = path.join(promptsDir, `${id}.md`);
  if (!fs.existsSync(file)) throw new Error(`プロンプト ${file} が見つかりません（npm run prompts を実行してください）`);
  return fs.readFileSync(file, 'utf8');
}

export const placeholders = (template) => [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];

// 値が文字列以外なら整形したJSONにする。空の値は「なし」と明示する
export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`プロンプトの変数 {{${name}}} に値が渡されていません`);
    const v = vars[name];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'なし';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}
