-- Additive account lifecycle; legacy users and credentials are not rewritten.
-- statement-breakpoint
CREATE TABLE auth_owner_setup (
 installation_id TEXT NOT NULL, admin_origin TEXT NOT NULL, email TEXT NOT NULL,
 claimed_at INTEGER, PRIMARY KEY(installation_id,admin_origin)
);
-- statement-breakpoint
CREATE TRIGGER auth_owner_setup_guard BEFORE INSERT ON auth_owner_setup BEGIN
 SELECT RAISE(ABORT,'auth_owner_exists') WHERE EXISTS(SELECT 1 FROM users);
END;
-- statement-breakpoint
CREATE TABLE auth_profiles (
 installation_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id), email_verified_at INTEGER,
 revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(installation_id,admin_origin,user_id)
);
-- statement-breakpoint
CREATE TABLE auth_actions (
 digest TEXT PRIMARY KEY, installation_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('owner','invite','verify','reset')),
 user_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
 issued_by TEXT, expected_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 consumed_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE INDEX auth_actions_scope ON auth_actions(installation_id,admin_origin,email,purpose);
-- statement-breakpoint
CREATE TABLE auth_mail_outbox (
 id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, admin_origin TEXT NOT NULL,
 action_digest TEXT REFERENCES auth_actions(digest), message_cipher TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed','superseded')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, sent_at INTEGER
);
-- statement-breakpoint
CREATE INDEX auth_mail_pending ON auth_mail_outbox(installation_id,admin_origin,status,created_at);
-- statement-breakpoint
CREATE TRIGGER auth_action_issue_guard BEFORE INSERT ON auth_actions BEGIN
 SELECT RAISE(ABORT,'auth_owner_exists') WHERE NEW.purpose='owner' AND (
  EXISTS(SELECT 1 FROM users) OR NOT EXISTS(SELECT 1 FROM auth_owner_setup s WHERE s.installation_id=NEW.installation_id AND s.admin_origin=NEW.admin_origin AND s.email=NEW.email AND s.claimed_at IS NULL)
 );
 SELECT RAISE(ABORT,'auth_invite_forbidden') WHERE NEW.purpose='invite' AND (
  NEW.role NOT IN ('administrator','editor','analyst') OR EXISTS(SELECT 1 FROM users WHERE email=NEW.email)
  OR NOT EXISTS(SELECT 1 FROM users u JOIN auth_profiles p ON p.user_id=u.id WHERE u.id=NEW.issued_by AND u.active=1 AND u.role='owner' AND p.installation_id=NEW.installation_id AND p.admin_origin=NEW.admin_origin AND p.email_verified_at IS NOT NULL AND p.revision=NEW.expected_revision)
 );
 SELECT RAISE(ABORT,'auth_stale_action') WHERE NEW.purpose IN ('verify','reset') AND NOT EXISTS(
  SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.email=NEW.email AND u.active=1
  AND COALESCE((SELECT revision FROM auth_profiles p WHERE p.user_id=u.id AND p.installation_id=NEW.installation_id AND p.admin_origin=NEW.admin_origin),0)=NEW.expected_revision
 );
END;
-- statement-breakpoint
CREATE TABLE auth_action_completions (
 digest TEXT PRIMARY KEY REFERENCES auth_actions(digest), installation_id TEXT NOT NULL,
 admin_origin TEXT NOT NULL, created_at INTEGER NOT NULL,
 salt TEXT, tag TEXT, iterations INTEGER, key_bits INTEGER
);
-- statement-breakpoint
CREATE TRIGGER auth_action_complete_guard BEFORE INSERT ON auth_action_completions BEGIN
 SELECT RAISE(ABORT,'auth_invalid_action') WHERE NOT EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.installation_id=NEW.installation_id AND a.admin_origin=NEW.admin_origin AND a.expires_at>unixepoch() AND a.consumed_at IS NULL AND a.revoked_at IS NULL);
 SELECT RAISE(ABORT,'auth_owner_exists') WHERE EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.purpose='owner') AND (EXISTS(SELECT 1 FROM users) OR NOT EXISTS(SELECT 1 FROM auth_owner_setup s JOIN auth_actions a ON a.installation_id=s.installation_id AND a.admin_origin=s.admin_origin AND a.email=s.email WHERE a.digest=NEW.digest AND s.claimed_at IS NULL));
 SELECT RAISE(ABORT,'auth_invite_forbidden') WHERE EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.purpose='invite' AND (
  a.role NOT IN ('administrator','editor','analyst') OR EXISTS(SELECT 1 FROM users WHERE email=a.email)
  OR NOT EXISTS(SELECT 1 FROM users u JOIN auth_profiles p ON p.user_id=u.id WHERE u.id=a.issued_by AND u.active=1 AND u.role='owner' AND p.installation_id=a.installation_id AND p.admin_origin=a.admin_origin AND p.email_verified_at IS NOT NULL AND p.revision=a.expected_revision)
 ));
 SELECT RAISE(ABORT,'auth_stale_action') WHERE EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.purpose IN ('verify','reset') AND NOT EXISTS(
  SELECT 1 FROM users u WHERE u.id=a.user_id AND u.email=a.email AND u.active=1 AND COALESCE((SELECT revision FROM auth_profiles p WHERE p.user_id=u.id AND p.installation_id=a.installation_id AND p.admin_origin=a.admin_origin),0)=a.expected_revision
 ));
 SELECT RAISE(ABORT,'auth_invalid_password') WHERE EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.purpose IN ('owner','invite','reset')) AND (NEW.salt IS NULL OR length(NEW.salt)<>64 OR NEW.tag IS NULL OR length(NEW.tag)<>64 OR NEW.iterations IS NULL OR NEW.key_bits IS NULL OR NEW.iterations<>100000 OR NEW.key_bits<>1536);
END;
-- statement-breakpoint
CREATE TRIGGER auth_action_complete AFTER INSERT ON auth_action_completions BEGIN
 INSERT INTO users(id,email,role,active) SELECT user_id,email,role,1 FROM auth_actions WHERE digest=NEW.digest AND purpose IN ('owner','invite');
 INSERT INTO password_credentials(user_id,salt,tag,iterations,key_bits)
 SELECT user_id,NEW.salt,NEW.tag,NEW.iterations,NEW.key_bits FROM auth_actions WHERE digest=NEW.digest AND purpose IN ('owner','invite','reset')
 ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,tag=excluded.tag,iterations=excluded.iterations,key_bits=excluded.key_bits;
 INSERT INTO auth_profiles(installation_id,admin_origin,user_id,email_verified_at,revision)
 SELECT installation_id,admin_origin,user_id,unixepoch(),CASE WHEN purpose IN ('owner','invite') THEN 1 ELSE expected_revision+1 END FROM auth_actions WHERE digest=NEW.digest
 ON CONFLICT(installation_id,admin_origin,user_id) DO UPDATE SET email_verified_at=excluded.email_verified_at,revision=auth_profiles.revision+1;
 UPDATE auth_owner_setup SET claimed_at=unixepoch() WHERE installation_id=NEW.installation_id AND admin_origin=NEW.admin_origin AND EXISTS(SELECT 1 FROM auth_actions a WHERE a.digest=NEW.digest AND a.purpose='owner');
 UPDATE auth_actions SET consumed_at=unixepoch() WHERE digest=NEW.digest;
 UPDATE auth_actions SET revoked_at=unixepoch() WHERE digest<>NEW.digest AND consumed_at IS NULL AND revoked_at IS NULL AND (user_id=(SELECT user_id FROM auth_actions WHERE digest=NEW.digest) OR issued_by=(SELECT user_id FROM auth_actions WHERE digest=NEW.digest)) AND installation_id=NEW.installation_id AND admin_origin=NEW.admin_origin;
 UPDATE auth_mail_outbox SET status='superseded' WHERE installation_id=NEW.installation_id AND admin_origin=NEW.admin_origin AND status IN ('pending','sending','failed') AND action_digest IN (SELECT digest FROM auth_actions WHERE consumed_at IS NOT NULL OR revoked_at IS NOT NULL);
 DELETE FROM sessions WHERE user_id=(SELECT user_id FROM auth_actions WHERE digest=NEW.digest AND purpose IN ('owner','invite','reset'));
 DELETE FROM login_tokens WHERE user_id=(SELECT user_id FROM auth_actions WHERE digest=NEW.digest AND purpose IN ('owner','invite','reset'));
 INSERT INTO audit(id,actor,action) SELECT lower(hex(randomblob(16))),user_id,CASE purpose WHEN 'owner' THEN 'Completed owner setup' WHEN 'invite' THEN 'Accepted team invitation' WHEN 'verify' THEN 'Verified email address' ELSE 'Reset password and revoked sessions' END FROM auth_actions WHERE digest=NEW.digest;
 UPDATE auth_action_completions SET salt=NULL,tag=NULL,iterations=NULL,key_bits=NULL WHERE digest=NEW.digest;
END;
-- statement-breakpoint
CREATE TRIGGER auth_user_identity_changed AFTER UPDATE OF email,role,active ON users
WHEN OLD.email<>NEW.email OR OLD.role<>NEW.role OR OLD.active<>NEW.active BEGIN
 UPDATE auth_profiles SET revision=revision+1,email_verified_at=CASE WHEN OLD.email<>NEW.email THEN NULL ELSE email_verified_at END WHERE user_id=NEW.id;
 UPDATE auth_actions SET revoked_at=unixepoch() WHERE consumed_at IS NULL AND revoked_at IS NULL AND (user_id=NEW.id OR issued_by=NEW.id);
 UPDATE auth_mail_outbox SET status='superseded' WHERE status IN ('pending','sending','failed') AND action_digest IN (SELECT digest FROM auth_actions WHERE revoked_at IS NOT NULL);
 DELETE FROM sessions WHERE user_id=NEW.id;
 DELETE FROM login_tokens WHERE user_id=NEW.id;
END;
