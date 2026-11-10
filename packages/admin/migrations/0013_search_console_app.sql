-- Owner-managed OAuth application credentials, encrypted with the installation key ring.
CREATE TABLE search_console_apps (
  scope TEXT PRIMARY KEY, site_id TEXT NOT NULL, revision INTEGER NOT NULL,
  credentials_cipher TEXT NOT NULL, updated_at INTEGER NOT NULL
);
