-- Optional managed billing only; scoped independently for each account and mode.
CREATE TABLE billing_setup_health (
  scope TEXT PRIMARY KEY,
  scheduled_at INTEGER NOT NULL DEFAULT 0,
  webhook_at INTEGER NOT NULL DEFAULT 0
);
