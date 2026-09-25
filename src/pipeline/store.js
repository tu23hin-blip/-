// data/ 配下のファイル（ジャンル一覧・勝ちパターン・ネタの記録など）の読み書き
import fs from 'node:fs';
import path from 'node:path';

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${file} を読み込めませんでした（${e.message}）`);
  }
}

// ジャンル追加時に使う配色（既存ジャンルと重ならないものを順に選ぶ）
export const PALETTES = [
  { primary: '#6657df', secondary: '#2b2548', accent: '#f5a76a' },
  { primary: '#0f8b8d', secondary: '#12343b', accent: '#f2c14e' },
  { primary: '#e05a47', secondary: '#3a1f1d', accent: '#ffd166' },
  { primary: '#2f6fde', secondary: '#172a4d', accent: '#7ee0b0' },
  { primary: '#c2408f', secondary: '#35162b', accent: '#ffb86b' },
  { primary: '#3a9d5d', secondary: '#173322', accent: '#f6d860' },
];

export class Store {
  constructor(dir) {
    this.dir = dir;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  readText(name, fallback = '') {
    try {
      return fs.readFileSync(this.file(name), 'utf8').trim();
    } catch {
      return fallback;
    }
  }

  genres() {
    return readJson(this.file('genres.json'), { genres: [] }).genres || [];
  }

  saveGenres(genres) {
    writeJsonAtomic(this.file('genres.json'), { genres });
  }

  patterns() {
    return { patterns: [], eyecatch_patterns: [], x_mix: null, time_performance: null, ...readJson(this.file('patterns.json'), {}) };
  }

  savePatterns(value) {
    writeJsonAtomic(this.file('patterns.json'), value);
  }

  xTests() {
    return readJson(this.file('x_tests.json'), []);
  }

  saveXTests(value) {
    writeJsonAtomic(this.file('x_tests.json'), value);
  }

  appendLog(name, rows) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.file(name), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  }

  experimentData(genreId) {
    return this.readText(path.join('experiments', `${genreId}.md`));
  }

  nextPalette() {
    const used = new Set(this.genres().map((g) => g.colors?.primary));
    return { ...(PALETTES.find((p) => !used.has(p.primary)) || PALETTES[this.genres().length % PALETTES.length]) };
  }
}
