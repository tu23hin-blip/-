// 事業部の設定（engine/divisions/<slug>/division.yaml）を読む。
// 事業部を1つ足す = このフォルダと .claude/skills/<skill>/SKILL.md を足すだけ。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { config } from './config.js';

export function listDivisionConfigs() {
  if (!fs.existsSync(config.divisionsDir)) return [];
  return fs.readdirSync(config.divisionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(config.divisionsDir, e.name, 'division.yaml')))
    .map((e) => loadDivisionConfig(e.name));
}

export function loadDivisionConfig(slug) {
  const dir = path.join(config.divisionsDir, slug);
  const file = path.join(dir, 'division.yaml');
  if (!fs.existsSync(file)) throw new Error(`事業部の設定がありません: engine/divisions/${slug}/division.yaml`);
  const cfg = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (cfg.slug !== slug) throw new Error(`division.yaml の slug（${cfg.slug}）がフォルダ名（${slug}）と違います`);
  return { ...cfg, dir };
}

/** DBの divisions を設定ファイルと同期（新しい事業部は追加、既存は名前とSkillのみ更新） */
export function syncDivisions(rec) {
  const configs = listDivisionConfigs();
  for (const c of configs) {
    rec.ensure_division({ slug: c.slug, name: c.name, skill_name: c.skill || null, weekly_goal: c.weekly_goal ?? null, status: c.initial_status });
  }
  return configs;
}
