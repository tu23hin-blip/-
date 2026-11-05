// CSV から metrics を取り込む。
//   npm run metrics:import -- path/to/file.csv
// 列: date,division,name,value[,url]
//   division … slug（x-note）または事業部名
//   value    … 空欄なら「不明(null)」として記録
//   url      … 任意。投稿URL（outputs.published_url）を書くと投稿ごとの数字として記録
// 1行でもエラーがあれば何も取り込まない（中途半端な状態を作らない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, createRecorder, METRIC_NAMES } from './index.js';

/** 簡易CSVパーサ（ダブルクオート対応） */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function importMetricsCsv(db, text) {
  const rec = createRecorder(db);
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length === 0) return { imported: 0, errors: ['CSVが空です'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const need = ['date', 'division', 'name', 'value'];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length) return { imported: 0, errors: [`ヘッダーに ${missing.join(', ')} がありません（必要な列: date,division,name,value[,url]）`] };
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const errors = [];
  const items = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (idx[k] == null ? '' : (r[idx[k]] ?? '').trim());
    const date = get('date').replace(/\//g, '-');
    const division = get('division');
    const name = get('name');
    const valueRaw = get('value').replace(/[,，¥円]/g, '');
    const url = get('url');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errors.push(`${line}行目: 日付が YYYY-MM-DD ではありません（${date}）`);
    if (!METRIC_NAMES.includes(name)) return errors.push(`${line}行目: name は ${METRIC_NAMES.join('/')} のどれかにしてください（${name}）`);
    let divRow;
    try { divRow = rec.resolveDivision(division); } catch { return errors.push(`${line}行目: 事業部が見つかりません（${division}）`); }
    const value = valueRaw === '' ? null : Number(valueRaw);
    if (value !== null && !Number.isFinite(value)) return errors.push(`${line}行目: value が数値ではありません（${valueRaw}）`);
    let outputId = null;
    if (url) {
      const o = db.prepare('SELECT id FROM outputs WHERE published_url = ?').get(url);
      if (!o) return errors.push(`${line}行目: その投稿URLの成果物が見つかりません（${url}）。承認待ちの受け箱で投稿URLを登録してください`);
      outputId = o.id;
    }
    items.push({ date, division: divRow.id, name, value, output_id: outputId });
  });

  if (errors.length) return { imported: 0, errors };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const it of items) rec.record_metric(it);
    rec.log_event({ type: 'progress', message: `CSVから数字を取り込み: ${items.length}行` });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { imported: items.length, errors: [] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) { console.error('使い方: npm run metrics:import -- path/to/file.csv'); process.exit(1); }
  const result = importMetricsCsv(openDb(), fs.readFileSync(file, 'utf8'));
  if (result.errors.length) {
    console.error('取り込みを中止しました（1行も取り込んでいません）:');
    for (const e of result.errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`${result.imported} 行を取り込みました。`);
}
