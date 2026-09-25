// LLMの出力からJSONオブジェクトを取り出す。前置きの文章・コードフェンス・末尾カンマ・文字列内の生の改行に耐える。

// start の '{' に対応する '}' の位置（文字列内の括弧は数えない）
function matchBrace(s, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// よくある崩れ（文字列内の生の改行・タブ、閉じ括弧前の余分なカンマ）を直す
export function repairJsonLike(s) {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === '"') inString = false;
      out += c === '\n' ? '\\n' : c === '\r' ? '' : c === '\t' ? '\\t' : c;
    } else {
      if (c === '"') inString = true;
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const tryParse = (s) => {
  try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, error: e.message }; }
};

export function extractJson(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, error: '出力が空でした' };
  let parsed = tryParse(t);
  if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) return parsed;

  let best = null;
  let lastError = parsed.error;
  for (let i = t.indexOf('{'); i !== -1; i = t.indexOf('{', i + 1)) {
    const end = matchBrace(t, i);
    if (end === -1) continue;
    const candidate = t.slice(i, end + 1);
    parsed = tryParse(candidate);
    if (!parsed.ok) parsed = tryParse(repairJsonLike(candidate));
    if (parsed.ok) {
      if (!best || candidate.length > best.length) best = { value: parsed.value, length: candidate.length };
      i = end; // 内側の小さいオブジェクトは見ない
    } else lastError = parsed.error;
  }
  return best ? { ok: true, value: best.value } : { ok: false, error: `JSONとして解析できません（${lastError || '波括弧が閉じていません'}）` };
}

export function missingKeys(obj, required = []) {
  return required.filter((k) => obj?.[k] === undefined || obj[k] === null);
}
