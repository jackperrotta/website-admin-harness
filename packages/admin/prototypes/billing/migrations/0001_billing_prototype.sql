-- Optional isolated billing preview. Never part of ordinary installation migrations.
CREATE TABLE billing_prototype (
  installation_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  payload TEXT NOT NULL,
  receipts TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (installation_id, site_id)
);
