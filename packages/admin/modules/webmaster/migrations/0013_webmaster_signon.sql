-- Optional human sign-on; apply deliberately after core 0011 on the owning D1.
CREATE TABLE webmaster_sso_broker_flows (
 installation_id TEXT NOT NULL,site_id TEXT NOT NULL,admin_origin TEXT NOT NULL,id TEXT NOT NULL,
 session_digest TEXT NOT NULL,subject_id TEXT NOT NULL,client_json TEXT NOT NULL,
 challenge TEXT,state_id TEXT,code_hash TEXT,expires_at INTEGER NOT NULL,code_expires_at INTEGER,consumed_at INTEGER,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_sso_broker_leases (
 installation_id TEXT NOT NULL,site_id TEXT NOT NULL,admin_origin TEXT NOT NULL,id TEXT NOT NULL,
 session_digest TEXT NOT NULL,subject_id TEXT NOT NULL,client_json TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_sso_flows (
 installation_id TEXT NOT NULL,site_id TEXT NOT NULL,admin_origin TEXT NOT NULL,id TEXT NOT NULL,
 broker_flow_id TEXT NOT NULL,verifier_cipher TEXT NOT NULL,assertion_cipher TEXT,
 expires_at INTEGER NOT NULL,completed_at INTEGER,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_sso_grants (
 installation_id TEXT NOT NULL,site_id TEXT NOT NULL,admin_origin TEXT NOT NULL,id TEXT NOT NULL,
 broker_json TEXT NOT NULL,subject_id TEXT NOT NULL,subject_email TEXT NOT NULL,local_user_id TEXT NOT NULL,
 organization_id TEXT NOT NULL,key_id TEXT NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER,
 PRIMARY KEY(installation_id,site_id,admin_origin,id),
 UNIQUE(installation_id,site_id,admin_origin,broker_json,subject_id)
);
-- statement-breakpoint
CREATE TABLE webmaster_sso_sessions (
 installation_id TEXT NOT NULL,site_id TEXT NOT NULL,admin_origin TEXT NOT NULL,id TEXT NOT NULL,
 grant_id TEXT NOT NULL,lease_cipher TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TRIGGER webmaster_sso_organization_revoked AFTER UPDATE ON webmaster_connections
WHEN OLD.organization_id<>NEW.organization_id OR (OLD.status='connected' AND NEW.status='disconnected')
BEGIN
 DELETE FROM sessions WHERE digest IN (SELECT s.id FROM webmaster_sso_sessions s JOIN webmaster_sso_grants g ON g.installation_id=s.installation_id AND g.site_id=s.site_id AND g.admin_origin=s.admin_origin AND g.id=s.grant_id WHERE g.installation_id=OLD.installation_id AND g.site_id=OLD.site_id AND g.admin_origin=OLD.admin_origin AND g.organization_id=OLD.organization_id);
 UPDATE webmaster_sso_grants SET revoked_at=CAST(strftime('%s','now') AS INTEGER) WHERE installation_id=OLD.installation_id AND site_id=OLD.site_id AND admin_origin=OLD.admin_origin AND organization_id=OLD.organization_id AND revoked_at IS NULL;
END;
