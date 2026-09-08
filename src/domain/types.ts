/** ドメイン共通の型定義。DB 行の形と 1:1 で対応する。 */

export type OrgKind = 'client' | 'agency' | 'media';
export type UserRole = 'owner' | 'admin' | 'operator' | 'legal' | 'viewer' | 'system';

/** 薬機法の判定はカテゴリで大きく変わるため、広告主に必ず持たせる */
export type AdvertiserCategory =
  | 'cosmetics'          // 化粧品
  | 'quasi_drug'         // 医薬部外品
  | 'drug'               // 医薬品
  | 'supplement'         // 健康食品・サプリ
  | 'food_with_claims'   // 機能性表示食品・特保
  | 'medical_device'     // 医療機器
  | 'general';           // 一般（薬機法対象外）

export type OrderType = 'video_ad' | 'article_lp' | 'lp' | 'meta_operation';

/** 受注 → 制作 → 法務 → 承認 → 納品 → 運用 のライフサイクル */
export type OrderStatus =
  | 'requested'        // 依頼受付
  | 'accepted'         // メディア側が受注
  | 'in_production'    // 制作中（パイプライン実行中）
  | 'internal_review'  // 社内QC
  | 'legal_review'     // 法務チェック
  | 'revision'         // 差戻し・修正中
  | 'client_review'    // クライアント確認待ち
  | 'approved'         // 承認済
  | 'delivered'        // 納品済
  | 'live'             // 入稿・配信中
  | 'completed'        // 完了
  | 'rejected'         // 却下
  | 'cancelled';       // 取消

export type AssetSource = 'client_provided' | 'ai_generated' | 'derived';
export type AssetKind = 'video' | 'image' | 'audio' | 'text' | 'font' | 'subtitle';
export type DeliverableKind = 'video' | 'article_lp' | 'lp';
export type LegalStatus = 'pending' | 'pass' | 'warn' | 'block';
export type Severity = 'block' | 'warn' | 'info';
export type AutopilotLevel = 'off' | 'suggest' | 'auto_safe' | 'auto_full';

export type Organization = {
  id: string;
  kind: OrgKind;
  name: string;
  legal_name: string | null;
  invoice_no: string | null;
  address: string | null;
  tel: string | null;
  contact_email: string | null;
  is_individual: number;
  closing_day: number;
  payment_terms: string;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: UserRole;
  api_key_hash: string | null;
  active: number;
  created_at: string;
};

export type Advertiser = {
  id: string;
  org_id: string;
  name: string;
  product_name: string | null;
  category: AdvertiserCategory;
  site_url: string | null;
  brand_guide: string | null;
  ng_words: string | null;
  created_at: string;
};

export type Project = {
  id: string;
  advertiser_id: string;
  client_org_id: string;
  agency_org_id: string;
  media_org_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  objective: string;
  monthly_budget: number;
  daily_budget: number;
  target_cpa: number;
  target_roas: number;
  revenue_model: 'fixed' | 'cpa' | 'revshare';
  client_unit_price: number;
  media_unit_price: number;
  agency_margin_rate: number;
  start_date: string | null;
  end_date: string | null;
  autopilot: number;
  autopilot_level: AutopilotLevel;
  created_at: string;
  updated_at: string;
};

/** 発注時のブリーフ。ここがパイプライン全体の入力になる。 */
export type Brief = {
  product: string;
  category?: AdvertiserCategory;
  target: string;                       // ペルソナ
  painPoints?: string[];
  usp: string[];                        // 訴求ポイント
  offer?: string;                       // オファー（初回半額 等）
  tone?: string;                        // トンマナ
  ngWords?: string[];
  references?: string[];
  landingUrl?: string;
  /** 動画用 */
  durationSec?: number;
  aspectRatios?: AspectRatio[];
  variations?: number;
  hookStyles?: string[];
  narration?: boolean;
  subtitles?: boolean;
  bgm?: boolean;
  /** 提供素材（クライアント支給）。AI生成素材と合わせてこれ以外は使わない。 */
  providedAssetIds?: string[];
  /** 記事LP / LP 用 */
  sections?: string[];
  wordCount?: number;
  cta?: string;
  /** META運用用 */
  metaObjective?: string;
  dailyBudget?: number;
  audiences?: string[];
  placements?: string[];
};

export type AspectRatio = '9:16' | '1:1' | '4:5' | '16:9';

export type Order = {
  id: string;
  project_id: string;
  type: OrderType;
  title: string;
  brief: string;
  quantity: number;
  status: OrderStatus;
  priority: number;
  due_date: string | null;
  client_amount: number;
  media_amount: number;
  requested_by: string | null;
  auto_generated: number;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  project_id: string | null;
  order_id: string | null;
  source: AssetSource;
  kind: AssetKind;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  storage_path: string;
  mime: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  checksum: string | null;
  license_note: string | null;
  meta: string | null;
  created_at: string;
};

export type Deliverable = {
  id: string;
  order_id: string;
  project_id: string;
  kind: DeliverableKind;
  version: number;
  title: string;
  status: string;
  storage_path: string | null;
  preview_path: string | null;
  content: string | null;
  spec: string | null;
  qc: string | null;
  legal_status: LegalStatus;
  approved_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LegalFinding = {
  law: 'yakkihou' | 'keihyo' | 'custom';
  severity: Severity;
  /** 原文中の該当箇所そのもの */
  phrase: string;
  /** 前後を含めた抜粋（レビュー画面で位置を掴むため） */
  context: string;
  index: number;
  reason: string;
  suggestion: string | null;
  ruleId?: string;
  source: 'rules' | 'llm';
};

export type LegalReview = {
  id: string;
  project_id: string | null;
  subject_type: string;
  subject_id: string | null;
  category: AdvertiserCategory;
  engine: 'rules' | 'llm' | 'hybrid' | 'human';
  status: 'pass' | 'warn' | 'block';
  score: number;
  findings: string;
  revised_text: string | null;
  original_text: string | null;
  reviewer: string | null;
  created_at: string;
};

export type MetaLevel = 'campaign' | 'adset' | 'ad' | 'creative';

export type MetaObject = {
  id: string;
  project_id: string;
  level: MetaLevel;
  remote_id: string | null;
  parent_id: string | null;
  name: string;
  status: string;
  daily_budget: number | null;
  config: string;
  deliverable_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Insight = {
  id: string;
  project_id: string;
  date: string;
  level: string;
  object_id: string;
  remote_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversion_value: number;
  video_p25: number;
  video_p75: number;
  thruplays: number;
  raw: string | null;
  synced_at: string;
};

export type OptimizerAction = {
  id: string;
  project_id: string;
  date: string;
  rule: string;
  level: string;
  object_id: string | null;
  object_name: string | null;
  action: string;
  reason: string;
  before: string | null;
  after: string | null;
  applied: number;
  applied_at: string | null;
  error: string | null;
  created_at: string;
};

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: 10 | 8 | 0;
  note?: string;
};

export type Invoice = {
  id: string;
  invoice_no: string;
  direction: 'receivable' | 'payable';
  project_id: string | null;
  issuer_org_id: string;
  bill_to_org_id: string;
  issue_date: string;
  due_date: string;
  period_from: string | null;
  period_to: string | null;
  lines: string;
  subtotal: number;
  tax: number;
  total: number;
  withholding: number;
  payable: number;
  status: 'draft' | 'issued' | 'sent' | 'paid' | 'void';
  paid_at: string | null;
  storage_path: string | null;
  html: string | null;
  created_at: string;
  updated_at: string;
};

export type Contract = {
  id: string;
  project_id: string | null;
  kind: 'master' | 'individual' | 'nda' | 'media_partner';
  title: string;
  from_org_id: string;
  to_org_id: string;
  body_md: string;
  variables: string;
  status: 'draft' | 'sent' | 'signed' | 'expired' | 'void';
  effective_date: string | null;
  expire_date: string | null;
  signed_at: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
};

export type Report = {
  id: string;
  project_id: string | null;
  scope: string;
  type: 'daily' | 'weekly' | 'monthly';
  date: string;
  title: string;
  summary: string;
  markdown: string | null;
  html: string | null;
  storage_path: string | null;
  delivery_status: string;
  delivered_at: string | null;
  created_at: string;
};

export type PipelineStepRecord = {
  name: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  output?: unknown;
};

export type PipelineRun = {
  id: string;
  order_id: string;
  pipeline: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  current_step: string | null;
  steps: string;
  context: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
