-- Example installed module. Enablement is separate from migration application.
CREATE TABLE tasks (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX tasks_site ON tasks(site_id,created_at);
