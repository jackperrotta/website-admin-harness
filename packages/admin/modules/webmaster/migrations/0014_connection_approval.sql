-- Optional combined approval, after reporting 0012 and sign-on 0013.
CREATE TABLE webmaster_pairing_signon (
 installation_id TEXT NOT NULL, site_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 request_id TEXT NOT NULL, subject_id TEXT NOT NULL, subject_email TEXT NOT NULL,
 key_id TEXT NOT NULL, local_user_id TEXT, approved_by TEXT,
 PRIMARY KEY(installation_id,site_id,admin_origin,request_id),
 FOREIGN KEY(installation_id,site_id,admin_origin,request_id)
 REFERENCES webmaster_pairing_requests(installation_id,site_id,admin_origin,id)
);
-- statement-breakpoint
CREATE TRIGGER webmaster_pairing_signon_exchange_guard
BEFORE UPDATE OF grant_id ON webmaster_pairing_requests
WHEN OLD.grant_id IS NULL AND NEW.grant_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'named_approval_changed') WHERE EXISTS(
  SELECT 1 FROM webmaster_pairing_signon s WHERE s.installation_id=NEW.installation_id
  AND s.site_id=NEW.site_id AND s.admin_origin=NEW.admin_origin AND s.request_id=NEW.id
  AND s.local_user_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM users WHERE id=s.local_user_id AND active=1)
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=s.approved_by AND active=1 AND role='owner')
  )
 );
END;
