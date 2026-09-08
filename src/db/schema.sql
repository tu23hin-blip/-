-- =====================================================================
--  広告代理店ASP（クライアント → 代理店 → メディア）スキーマ
--  金額はすべて「円・整数」。日時は ISO8601(UTC) 文字列。業務日付は JST の YYYY-MM-DD。
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------- 組織・ユーザー ----------
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('client','agency','media')),
  name          TEXT NOT NULL,
  legal_name    TEXT,
  invoice_no    TEXT,                      -- 適格請求書発行事業者登録番号 T+13桁
  address       TEXT,
  tel           TEXT,
  contact_email TEXT,
  is_individual INTEGER NOT NULL DEFAULT 0, -- 1 なら源泉徴収の対象
  closing_day   INTEGER NOT NULL DEFAULT 31, -- 締日
  payment_terms TEXT NOT NULL DEFAULT '翌月末',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','operator','legal','viewer','system')),
  api_key_hash TEXT UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- ---------- 広告主・案件 ----------
CREATE TABLE IF NOT EXISTS advertisers (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  product_name  TEXT,
  category      TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('cosmetics','quasi_drug','drug','supplement','food_with_claims','medical_device','general')),
  site_url      TEXT,
  brand_guide   TEXT,                       -- トンマナ・禁止表現などの自由記述
  ng_words      TEXT,                       -- JSON配列
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  advertiser_id      TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  client_org_id      TEXT NOT NULL REFERENCES organizations(id),
  agency_org_id      TEXT NOT NULL REFERENCES organizations(id),
  media_org_id       TEXT NOT NULL REFERENCES organizations(id),
  name               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('draft','active','paused','completed','archived')),
  objective          TEXT NOT NULL DEFAULT 'conversions',
  monthly_budget     INTEGER NOT NULL DEFAULT 0,
  daily_budget       INTEGER NOT NULL DEFAULT 0,
  target_cpa         INTEGER NOT NULL DEFAULT 0,
  target_roas        REAL NOT NULL DEFAULT 0,
  revenue_model      TEXT NOT NULL DEFAULT 'fixed' CHECK (revenue_model IN ('fixed','cpa','revshare')),
  client_unit_price  INTEGER NOT NULL DEFAULT 0,  -- クライアント→代理店の単価（CPA等）
  media_unit_price   INTEGER NOT NULL DEFAULT 0,  -- 代理店→メディアの単価
  agency_margin_rate REAL NOT NULL DEFAULT 0.2,   -- revshare 時の代理店取り分
  start_date         TEXT,
  end_date           TEXT,
  autopilot          INTEGER NOT NULL DEFAULT 1,  -- 1 なら運用最適化を自動適用
  autopilot_level    TEXT NOT NULL DEFAULT 'suggest'
                     CHECK (autopilot_level IN ('off','suggest','auto_safe','auto_full')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ---------- 発注（クライアント→代理店→メディア） ----------
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('video_ad','article_lp','lp','meta_operation')),
  title          TEXT NOT NULL,
  brief          TEXT NOT NULL,                -- JSON: ターゲット/訴求/尺/本数/参考 など
  quantity       INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'requested',
  priority       INTEGER NOT NULL DEFAULT 5,
  due_date       TEXT,
  client_amount  INTEGER NOT NULL DEFAULT 0,   -- クライアント請求額
  media_amount   INTEGER NOT NULL DEFAULT 0,   -- メディア支払額
  requested_by   TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,   -- 運用側の自動判断で起票されたか
  source_ref     TEXT,                          -- 自動起票の根拠（疲弊検知など）
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_events (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state   TEXT NOT NULL,
  actor      TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- ---------- 素材・納品物 ----------
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  order_id     TEXT REFERENCES orders(id) ON DELETE SET NULL,
  source       TEXT NOT NULL CHECK (source IN ('client_provided','ai_generated','derived')),
  kind         TEXT NOT NULL CHECK (kind IN ('video','image','audio','text','font','subtitle')),
  provider     TEXT,
  model        TEXT,
  prompt       TEXT,
  storage_path TEXT NOT NULL,
  mime         TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  duration_sec REAL,
  checksum     TEXT,
  license_note TEXT,
  meta         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_order ON assets(order_id);
CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source);

CREATE TABLE IF NOT EXISTS deliverables (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('video','article_lp','lp')),
  version       INTEGER NOT NULL DEFAULT 1,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  storage_path  TEXT,
  preview_path  TEXT,
  content       TEXT,     -- 記事LP/LP は HTML/Markdown 本文をここに
  spec          TEXT,     -- JSON: 尺・比率・解像度・構成 など
  qc            TEXT,     -- JSON: QC結果
  legal_status  TEXT NOT NULL DEFAULT 'pending' CHECK (legal_status IN ('pending','pass','warn','block')),
  approved_at   TEXT,
  delivered_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliverables_order ON deliverables(order_id);

-- ---------- パイプライン ----------
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  pipeline     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','cancelled')),
  current_step TEXT,
  steps        TEXT NOT NULL DEFAULT '[]',   -- JSON: [{name,status,startedAt,finishedAt,error,output}]
  context      TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_order ON pipeline_runs(order_id);

-- ---------- ジョブキュー ----------
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','succeeded','failed','dead','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 5,
  run_at       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  dedupe_key   TEXT UNIQUE,
  locked_by    TEXT,
  locked_at    TEXT,
  last_error   TEXT,
  result       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_pick ON jobs(status, run_at, priority);

-- ---------- 法務 ----------
CREATE TABLE IF NOT EXISTS legal_reviews (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,          -- script / article_lp / lp / ad_copy / deliverable
  subject_id   TEXT,
  category     TEXT NOT NULL,          -- 広告主カテゴリ（薬機法の判定基準）
  engine       TEXT NOT NULL DEFAULT 'hybrid' CHECK (engine IN ('rules','llm','hybrid','human')),
  status       TEXT NOT NULL CHECK (status IN ('pass','warn','block')),
  score        INTEGER NOT NULL DEFAULT 100,
  findings     TEXT NOT NULL DEFAULT '[]',
  revised_text TEXT,
  original_text TEXT,
  reviewer     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_legal_subject ON legal_reviews(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS legal_rules (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL DEFAULT 'global',  -- global / advertiser:<id>
  law          TEXT NOT NULL,                   -- yakkihou / keihyo / custom
  category     TEXT,                            -- 対象カテゴリ（null なら全カテゴリ）
  pattern      TEXT NOT NULL,
  is_regex     INTEGER NOT NULL DEFAULT 0,
  severity     TEXT NOT NULL CHECK (severity IN ('block','warn','info')),
  reason       TEXT NOT NULL,
  suggestion   TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

-- ---------- Meta 広告 ----------
CREATE TABLE IF NOT EXISTS meta_accounts (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ad_account_id  TEXT NOT NULL,
  page_id        TEXT,
  pixel_id       TEXT,
  instagram_id   TEXT,
  token_ref      TEXT,          -- 実トークンは env / シークレットストア側。ここは参照名のみ
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_objects (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('campaign','adset','ad','creative')),
  remote_id     TEXT,
  parent_id     TEXT,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PAUSED',
  daily_budget  INTEGER,
  config        TEXT NOT NULL DEFAULT '{}',
  deliverable_id TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meta_objects_project ON meta_objects(project_id, level);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_objects_remote ON meta_objects(remote_id) WHERE remote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta_insights (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  level            TEXT NOT NULL,
  object_id        TEXT NOT NULL,      -- meta_objects.id
  remote_id        TEXT,
  spend            INTEGER NOT NULL DEFAULT 0,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  reach            INTEGER NOT NULL DEFAULT 0,
  frequency        REAL NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  conversion_value INTEGER NOT NULL DEFAULT 0,
  video_p25        INTEGER NOT NULL DEFAULT 0,
  video_p75        INTEGER NOT NULL DEFAULT 0,
  thruplays        INTEGER NOT NULL DEFAULT 0,
  raw              TEXT,
  synced_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_unique ON meta_insights(date, level, object_id);
CREATE INDEX IF NOT EXISTS idx_insights_project_date ON meta_insights(project_id, date);

CREATE TABLE IF NOT EXISTS optimizer_actions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  rule        TEXT NOT NULL,
  level       TEXT NOT NULL,
  object_id   TEXT,
  object_name TEXT,
  action      TEXT NOT NULL,       -- pause / scale_budget / reduce_budget / duplicate / request_creative
  reason      TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  applied     INTEGER NOT NULL DEFAULT 0,
  applied_at  TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optimizer_project_date ON optimizer_actions(project_id, date);

-- ---------- レポート ----------
CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'project',  -- project / agency / all
  type            TEXT NOT NULL CHECK (type IN ('daily','weekly','monthly')),
  date            TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '{}',
  markdown        TEXT,
  html            TEXT,
  storage_path    TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivered_at    TEXT,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique ON reports(scope, IFNULL(project_id,''), type, date);

-- ---------- 契約・請求 ----------
CREATE TABLE IF NOT EXISTS contracts (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('master','individual','nda','media_partner')),
  title         TEXT NOT NULL,
  from_org_id   TEXT NOT NULL REFERENCES organizations(id),
  to_org_id     TEXT NOT NULL REFERENCES organizations(id),
  body_md       TEXT NOT NULL,
  variables     TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','expired','void')),
  effective_date TEXT,
  expire_date   TEXT,
  signed_at     TEXT,
  storage_path  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  invoice_no      TEXT NOT NULL UNIQUE,
  direction       TEXT NOT NULL CHECK (direction IN ('receivable','payable')), -- 請求書 / 支払通知書
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  issuer_org_id   TEXT NOT NULL REFERENCES organizations(id),
  bill_to_org_id  TEXT NOT NULL REFERENCES organizations(id),
  issue_date      TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  period_from     TEXT,
  period_to       TEXT,
  lines           TEXT NOT NULL DEFAULT '[]',
  subtotal        INTEGER NOT NULL DEFAULT 0,
  tax             INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  withholding     INTEGER NOT NULL DEFAULT 0,
  payable         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','sent','paid','void')),
  paid_at         TEXT,
  storage_path    TEXT,
  html            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('client_revenue','media_cost','ad_spend','agency_margin')),
  counterparty_org_id TEXT REFERENCES organizations(id),
  amount            INTEGER NOT NULL,
  memo              TEXT,
  ref_type          TEXT,
  ref_id            TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_project_date ON ledger_entries(project_id, date);

-- ---------- 監査ログ・通知・設定 ----------
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  payload      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','critical')),
  title      TEXT NOT NULL,
  body       TEXT,
  channel    TEXT NOT NULL DEFAULT 'inapp',
  status     TEXT NOT NULL DEFAULT 'pending',
  sent_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
