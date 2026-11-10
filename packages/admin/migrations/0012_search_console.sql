-- Optional connection; no existing records or configuration are changed.
CREATE TABLE search_console_connections (
  scope TEXT PRIMARY KEY, site_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
  tokens_cipher TEXT, property TEXT, writable INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT, error TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  next_type INTEGER NOT NULL DEFAULT 0, next_sync_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE search_console_oauth (
  digest TEXT PRIMARY KEY, scope TEXT NOT NULL, site_id TEXT NOT NULL,
  user_id TEXT NOT NULL, revision INTEGER NOT NULL, browser_digest TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL, writable INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE search_console_reports (
  scope TEXT NOT NULL, site_id TEXT NOT NULL, revision INTEGER NOT NULL,
  report_key TEXT NOT NULL, report_json TEXT NOT NULL, fetched_at INTEGER NOT NULL,
  PRIMARY KEY(scope,revision,report_key)
);
CREATE INDEX search_console_reports_age ON search_console_reports(fetched_at);
