-- 最初の表一式（docs/api.md「3. データベース」）。時刻は UTC の ISO 8601 文字列。

CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  edit_key_hash TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX routes_created_at ON routes (created_at);
CREATE INDEX routes_expires_at ON routes (expires_at);

-- sort_key: 待ちの順番。通常は id と同じ値、再印刷は待ちの先頭より小さい値。
--   申し込みの batch の途中だけ NULL（同じ batch の中で id を入れる）。
-- raster: 白黒の生データ（1行 48 バイト × height 行）。終わったら NULL。
--   申し込みの直後の短い間だけ NULL のまま queued になる（画像を入れるまで claim されない）。
-- reprint_of: 再印刷なら元の印刷の id（回数上限に数えない）。
CREATE TABLE print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'printing', 'done', 'failed', 'canceled')),
  issue_no INTEGER NOT NULL,
  sort_key INTEGER,
  snapshot TEXT NOT NULL,
  raster BLOB,
  height INTEGER,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  error TEXT,
  reprint_of INTEGER,
  UNIQUE (client_id, request_id)
);
CREATE INDEX print_jobs_status_sort ON print_jobs (status, sort_key, id);
CREATE INDEX print_jobs_client_event ON print_jobs (client_id, event_code);
CREATE INDEX print_jobs_route ON print_jobs (route_id);
CREATE INDEX print_jobs_finished_at ON print_jobs (finished_at);

CREATE TABLE print_grants (
  client_id TEXT NOT NULL,
  event_code TEXT NOT NULL,
  extra INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, event_code)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- event_code は初めて必要になったときに作る
INSERT INTO settings (key, value) VALUES ('accepting', '1');
INSERT INTO settings (key, value) VALUES ('issue_counter', '0');
INSERT INTO settings (key, value) VALUES ('printer_last_seen', '');

-- key: 「種類:IP」。window_start: 数え始めた時刻（窓の区切り）
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX rate_limits_window_start ON rate_limits (window_start);
