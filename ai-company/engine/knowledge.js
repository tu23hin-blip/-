// 部門ごとの knowledge の置き場所。
//   メイン（knowledge_account なし）: knowledge/my-voice.md / my-experience.md / themes.md / research.yaml
//   別アカウント（division.yaml の knowledge_account: sub）: knowledge/accounts/sub/voice.md / experience.md / themes.md / research.yaml
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { config } from './config.js';
import { loadDivisionConfig } from './registry.js';

export function knowledgePaths(account = null) {
  if (!account) {
    return { voice: 'knowledge/my-voice.md', experience: 'knowledge/my-experience.md', themes: 'knowledge/themes.md', research: 'knowledge/research.yaml' };
  }
  const base = `knowledge/accounts/${account}`;
  return { voice: `${base}/voice.md`, experience: `${base}/experience.md`, themes: `${base}/themes.md`, research: `${base}/research.yaml` };
}

/** 部門の slug から knowledge の置き場所を返す */
export function knowledgePathsFor(slug) {
  const cfg = loadDivisionConfig(slug);
  return { account: cfg.knowledge_account || null, ...knowledgePaths(cfg.knowledge_account || null) };
}

/** knowledge/ の中のファイルだけを絶対パスにする（外へ書き出さないための確認） */
export function knowledgeFile(rel) {
  const abs = path.resolve(config.root, rel);
  const kb = path.resolve(config.knowledgeDir);
  // 相対パスは knowledge/ から始まる前提。KNOWLEDGE_DIR を差し替えている場合（テスト）はそちらに読み替える
  const mapped = rel.startsWith('knowledge/') ? path.join(kb, rel.slice('knowledge/'.length)) : abs;
  if (!(mapped + '').startsWith(kb + path.sep)) throw new Error(`knowledge/ の外のファイルは扱えません: ${rel}`);
  return mapped;
}

export function readKnowledge(rel) {
  const f = knowledgeFile(rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

/** research.yaml を読む（キーワードは5個まで、言語の既定は ja） */
export function loadResearchConfig(rel) {
  const text = readKnowledge(rel);
  if (text == null) throw new Error(`${rel} がありません。検索キーワード（5個まで）と言語を書いてください`);
  const y = YAML.parse(text) || {};
  const keywords = [].concat(y.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (keywords.length === 0) throw new Error(`${rel} に keywords がありません`);
  if (keywords.length > 5) throw new Error(`${rel} の keywords は5個までです（いま ${keywords.length} 個）`);
  const lang = String(y.lang || 'ja').trim();
  if (!/^[a-z]{2}$/.test(lang)) throw new Error(`${rel} の lang は2文字の言語コードにしてください（例: ja）`);
  return { keywords, lang };
}

// ---- 承認されたときだけ knowledge に反映する ----
export const RESEARCH_START = '<!-- research:start -->';
export const RESEARCH_END = '<!-- research:end -->';
export const EXPERIENCE_HEADING = '## 承認済みの実績（X の自分の投稿から抽出）';
export const KNOWLEDGE_UPDATE_TYPES = ['voice_update', 'experience_candidate', 'themes_update'];

/** themes.md にリサーチのセクションを入れる（前回のセクションは置き換え。ほかの部分はそのまま） */
export function mergeResearchSection(current, section) {
  const text = current || '# 発信テーマ\n';
  const s = text.indexOf(RESEARCH_START), e = text.indexOf(RESEARCH_END);
  if (s >= 0 && e > s) return text.slice(0, s) + section.trimEnd() + text.slice(e + RESEARCH_END.length);
  return `${text.trimEnd()}\n\n${section}`;
}

/** experience に1行追記（見出しがなければ末尾に作る。同じ行は二重に足さない） */
export function appendExperience(current, line) {
  const text = current || '# 実体験・実績\n';
  const item = `- ${line}`;
  if (text.includes(item)) return text;
  const i = text.indexOf(EXPERIENCE_HEADING);
  if (i < 0) return `${text.trimEnd()}\n\n${EXPERIENCE_HEADING}\n\n${item}\n`;
  const after = text.indexOf('\n## ', i + EXPERIENCE_HEADING.length);
  if (after < 0) return `${text.trimEnd()}\n${item}\n`;
  return `${text.slice(0, after).trimEnd()}\n${item}\n${text.slice(after)}`;
}

/**
 * 承認された knowledge の更新案を反映する。返り値はイベントに残す説明。
 * content は成果物ファイルの中身（voice は全文、themes はセクション）。
 */
export function applyKnowledgeUpdate(meta, content) {
  const file = knowledgeFile(meta.target_path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (meta.type === 'voice_update') {
    if (!content) throw new Error('口調の下書きファイルが見つかりません');
    let backup = null;
    if (current != null) {
      const dir = path.join(config.outputsDir, 'knowledge-backups');
      fs.mkdirSync(dir, { recursive: true });
      backup = path.join(dir, `${path.basename(file, '.md')}-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}.md`);
      fs.writeFileSync(backup, current);
    }
    fs.writeFileSync(file, content);
    return `${meta.target_path} を口調の下書きで上書きしました${backup ? `（前の内容は ${path.relative(config.root, backup)} に保存）` : ''}`;
  }
  if (meta.type === 'experience_candidate') {
    if (!meta.line) throw new Error('実績の候補の本文がありません');
    fs.writeFileSync(file, appendExperience(current, meta.line));
    return `${meta.target_path} に実績を1行追記しました: ${meta.line}`;
  }
  if (meta.type === 'themes_update') {
    if (!content || !content.includes(RESEARCH_START)) throw new Error('テーマの更新案ファイルが見つかりません');
    fs.writeFileSync(file, mergeResearchSection(current, content));
    return `${meta.target_path} の「今伸びているテーマ」を更新しました`;
  }
  throw new Error(`不明な更新の種類: ${meta.type}`);
}
