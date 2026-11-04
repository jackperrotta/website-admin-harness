-- Additive only. Keep member restriction rows after disconnect or removal.
CREATE TABLE webmaster_connections (
  installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
  organization_id TEXT NOT NULL, organization_name TEXT NOT NULL,
  billing_provider INTEGER NOT NULL DEFAULT 0 CHECK(billing_provider IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('connected','disconnected')),
  revision INTEGER NOT NULL DEFAULT 1, mutation_id TEXT NOT NULL,
  PRIMARY KEY(installation_id,site_id,admin_origin)
);
CREATE TABLE webmaster_members (
  installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), permissions_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  PRIMARY KEY(installation_id,site_id,admin_origin,user_id),
  FOREIGN KEY(installation_id,site_id,admin_origin) REFERENCES webmaster_connections(installation_id,site_id,admin_origin)
);
CREATE TABLE webmaster_activity (
  audit_id TEXT PRIMARY KEY REFERENCES audit(id),
  installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
  person_id TEXT NOT NULL, organization_id TEXT, organization_name TEXT
);
