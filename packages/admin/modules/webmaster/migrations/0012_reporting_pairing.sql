-- Optional: apply deliberately after core 0011 to the client issuer's owning D1.
CREATE TABLE webmaster_pairing_requests (
 installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 id TEXT NOT NULL, organization_id TEXT NOT NULL, organization_name TEXT NOT NULL,
 consumer_json TEXT NOT NULL, key_json TEXT NOT NULL, challenge TEXT NOT NULL,
 intent_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, approved_at INTEGER,
 revoked_at INTEGER, code_hash TEXT, code_cipher TEXT, exchange_hash TEXT,
 credential_cipher TEXT, receipt_expires_at INTEGER, grant_id TEXT,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_reporting_grants (
 installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 id TEXT NOT NULL, organization_id TEXT NOT NULL, organization_name TEXT NOT NULL,
 consumer_json TEXT NOT NULL, key_json TEXT NOT NULL, token_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER,
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_pairing_nonces (
 installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 id TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TABLE webmaster_pairing_receipts (
 installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 id TEXT NOT NULL, grant_id TEXT NOT NULL, intent_hash TEXT NOT NULL,
 response_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(installation_id,site_id,admin_origin,id)
);

-- statement-breakpoint
CREATE TRIGGER webmaster_reporting_relationship_revoked
AFTER UPDATE ON webmaster_connections
WHEN OLD.organization_id<>NEW.organization_id OR (OLD.status='connected' AND NEW.status='disconnected')
BEGIN
 UPDATE webmaster_reporting_grants SET revoked_at=CAST(strftime('%s','now') AS INTEGER),revision=revision+1
 WHERE installation_id=OLD.installation_id AND site_id=OLD.site_id AND admin_origin=OLD.admin_origin AND organization_id=OLD.organization_id AND revoked_at IS NULL;
 UPDATE webmaster_pairing_requests SET revoked_at=CAST(strftime('%s','now') AS INTEGER),code_cipher=NULL,credential_cipher=NULL
 WHERE installation_id=OLD.installation_id AND site_id=OLD.site_id AND admin_origin=OLD.admin_origin AND organization_id=OLD.organization_id AND revoked_at IS NULL;
END;
