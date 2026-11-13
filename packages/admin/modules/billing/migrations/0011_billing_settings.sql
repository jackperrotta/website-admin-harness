-- Optional owner-managed installation settings. Provider records remain in the optional billing schema.
CREATE TABLE IF NOT EXISTS billing_installation_settings (
  installation_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  admin_origin TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted_payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (installation_id, site_id, admin_origin)
);
