-- AI会社 SQLite スキーマ
-- 日時(created_at 等)は ISO8601(UTC)、metrics.date はローカル日付 YYYY-MM-DD

CREATE TABLE IF NOT EXISTS divisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  skill_name  TEXT,
  -- JSON: {"metric":"impressions","target":30000}（達成率の計算に使う）
  weekly_goal TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id INTEGER NOT NULL REFERENCES divisions(id),
  title       TEXT NOT NULL,
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','running','awaiting_approval','done','failed')),
  started_at  TEXT,
  finished_at TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_division ON tasks(division_id, status);

CREATE TABLE IF NOT EXISTS outputs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER REFERENCES tasks(id),
  division_id   INTEGER NOT NULL REFERENCES divisions(id),
  kind          TEXT NOT NULL CHECK (kind IN ('x_post','note_article','script','video','report')),
  file_path     TEXT,
  preview_text  TEXT,
  approval      TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','approved','rejected')),
  published_url TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- 拡張: 表示用タイトルと付加情報(JSON: theme, warnings, comments, type など)
  title         TEXT,
  meta          TEXT
);
CREATE INDEX IF NOT EXISTS idx_outputs_approval ON outputs(approval, division_id);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id INTEGER REFERENCES divisions(id),   -- NULL = 全社イベント
  task_id     INTEGER REFERENCES tasks(id),
  type        TEXT NOT NULL CHECK (type IN ('start','progress','finish','fail','approval')),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_division ON events(division_id, created_at);

CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  division_id INTEGER NOT NULL REFERENCES divisions(id),
  name        TEXT NOT NULL CHECK (name IN
              ('revenue_jpy','impressions','clicks','followers','posts','work_minutes','api_cost_jpy')),
  value       REAL,          -- NULL = 不明（0 とは区別する）
  -- 拡張: 投稿ごとの数字（NULL = 事業部全体の数字）
  output_id   INTEGER REFERENCES outputs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics
  ON metrics(date, division_id, name, IFNULL(output_id, 0));

-- システム設定・フラグ（ダミーデータ投入中かどうか等）
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
