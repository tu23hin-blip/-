import { all, get, run } from '../sqlite.ts';
import { newId } from '../../lib/id.ts';
import { nowIso } from '../../lib/date.ts';
import type { AdvertiserCategory, LegalFinding, LegalReview, Severity } from '../../domain/types.ts';

export type LegalRuleRow = {
  id: string;
  scope: string;
  law: 'yakkihou' | 'keihyo' | 'custom';
  category: string | null;
  pattern: string;
  is_regex: number;
  severity: Severity;
  reason: string;
  suggestion: string | null;
  enabled: number;
  created_at: string;
};

export const legalReviews = {
  create(input: {
    project_id?: string | null;
    subject_type: string;
    subject_id?: string | null;
    category: AdvertiserCategory;
    engine?: 'rules' | 'llm' | 'hybrid' | 'human';
    status: 'pass' | 'warn' | 'block';
    score: number;
    findings: LegalFinding[];
    original_text?: string;
    revised_text?: string | null;
    reviewer?: string;
  }): LegalReview {
    const id = newId('lgr');
    run(
      `INSERT INTO legal_reviews
       (id, project_id, subject_type, subject_id, category, engine, status, score, findings, revised_text, original_text, reviewer, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.project_id ?? null, input.subject_type, input.subject_id ?? null, input.category,
      input.engine ?? 'hybrid', input.status, input.score, JSON.stringify(input.findings),
      input.revised_text ?? null, input.original_text ?? null, input.reviewer ?? 'system', nowIso(),
    );
    return legalReviews.require(id);
  },
  find: (id: string) => get<LegalReview>('SELECT * FROM legal_reviews WHERE id = ?', id),
  require(id: string): LegalReview {
    const row = legalReviews.find(id);
    if (!row) throw new Error(`法務レビューが見つかりません: ${id}`);
    return row;
  },
  bySubject: (type: string, id: string) =>
    all<LegalReview>(
      'SELECT * FROM legal_reviews WHERE subject_type = ? AND subject_id = ? ORDER BY created_at DESC',
      type, id,
    ),
  byProject: (projectId: string, limit = 100) =>
    all<LegalReview>('SELECT * FROM legal_reviews WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', projectId, limit),
  recentBlocks: (limit = 50) =>
    all<LegalReview>("SELECT * FROM legal_reviews WHERE status = 'block' ORDER BY created_at DESC LIMIT ?", limit),
};

export const legalRules = {
  create(input: Omit<LegalRuleRow, 'id' | 'created_at'> & { id?: string }): LegalRuleRow {
    const id = input.id ?? newId('lrl');
    run(
      `INSERT INTO legal_rules (id, scope, law, category, pattern, is_regex, severity, reason, suggestion, enabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.scope, input.law, input.category, input.pattern, input.is_regex,
      input.severity, input.reason, input.suggestion, input.enabled, nowIso(),
    );
    return get<LegalRuleRow>('SELECT * FROM legal_rules WHERE id = ?', id)!;
  },
  /** グローバル + 広告主固有の有効ルールを取得 */
  active: (advertiserId?: string) =>
    all<LegalRuleRow>(
      `SELECT * FROM legal_rules WHERE enabled = 1 AND (scope = 'global' OR scope = ?)`,
      advertiserId ? `advertiser:${advertiserId}` : 'global',
    ),
  list: () => all<LegalRuleRow>('SELECT * FROM legal_rules ORDER BY law, severity'),
  setEnabled: (id: string, enabled: boolean) => run('UPDATE legal_rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id),
  count: () => get<{ n: number }>('SELECT COUNT(*) AS n FROM legal_rules')?.n ?? 0,
};
