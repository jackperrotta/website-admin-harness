-- Explicit opt-in notifications and independent appointment-scoped customer authority.
-- statement-breakpoint
CREATE TABLE scheduling_notification_outbox (
 site_id TEXT NOT NULL, id TEXT NOT NULL, appointment_id TEXT NOT NULL, appointment_revision INTEGER NOT NULL,
 kind TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('capture','send')), dedupe_key TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), message_cipher TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','captured','sending','accepted','unknown','blocked','superseded')),
 provider_message_id TEXT, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,id), UNIQUE(site_id,dedupe_key),
 FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE INDEX scheduling_notification_due ON scheduling_notification_outbox(site_id,status,created_at);
-- statement-breakpoint
CREATE TRIGGER scheduling_notification_created AFTER INSERT ON scheduling_appointments BEGIN
 INSERT INTO scheduling_notification_outbox(site_id,id,appointment_id,appointment_revision,kind,mode,dedupe_key,payload_json,created_at,updated_at)
 SELECT NEW.site_id,lower(hex(randomblob(16))),NEW.id,NEW.revision,
 CASE WHEN NEW.status='pending_approval' THEN 'request_received' ELSE 'confirmation' END,
 json_extract(s.config_json,'$.notifications.mode'),'automatic:'||NEW.id||':'||NEW.revision,
 json_object('id',NEW.id,'service_id',NEW.service_id,'provider_id',NEW.provider_id,'location_id',NEW.location_id,'starts_at',NEW.starts_at,'ends_at',NEW.ends_at,'occupied_starts_at',NEW.occupied_starts_at,'occupied_ends_at',NEW.occupied_ends_at,'status',NEW.status,'expires_at',NEW.expires_at,'customer_json',NEW.customer_json,'snapshot_json',NEW.snapshot_json,'revision',NEW.revision),NEW.updated_at,NEW.updated_at
 FROM scheduling_state s WHERE s.site_id=NEW.site_id AND json_extract(s.config_json,'$.notifications.enabled')=1;
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_notification_changed AFTER UPDATE ON scheduling_appointments
WHEN NEW.status IN ('confirmed','pending_approval','cancelled','declined','expired') AND (NEW.status<>OLD.status OR NEW.starts_at<>OLD.starts_at OR NEW.provider_id<>OLD.provider_id OR NEW.location_id<>OLD.location_id OR json_extract(NEW.customer_json,'$.email')<>json_extract(OLD.customer_json,'$.email')) BEGIN
 INSERT INTO scheduling_notification_outbox(site_id,id,appointment_id,appointment_revision,kind,mode,dedupe_key,payload_json,created_at,updated_at)
 SELECT NEW.site_id,lower(hex(randomblob(16))),NEW.id,NEW.revision,
 CASE WHEN NEW.status IN ('cancelled','declined','expired') THEN NEW.status WHEN NEW.starts_at<>OLD.starts_at OR NEW.provider_id<>OLD.provider_id OR NEW.location_id<>OLD.location_id THEN 'rescheduled' WHEN OLD.status='pending_approval' AND NEW.status='confirmed' THEN 'approved' WHEN NEW.status='pending_approval' THEN 'request_received' ELSE 'confirmation' END,
 json_extract(s.config_json,'$.notifications.mode'),'automatic:'||NEW.id||':'||NEW.revision,
 json_object('id',NEW.id,'service_id',NEW.service_id,'provider_id',NEW.provider_id,'location_id',NEW.location_id,'starts_at',NEW.starts_at,'ends_at',NEW.ends_at,'occupied_starts_at',NEW.occupied_starts_at,'occupied_ends_at',NEW.occupied_ends_at,'status',NEW.status,'expires_at',NEW.expires_at,'customer_json',NEW.customer_json,'snapshot_json',NEW.snapshot_json,'revision',NEW.revision),NEW.updated_at,NEW.updated_at
 FROM scheduling_state s WHERE s.site_id=NEW.site_id AND json_extract(s.config_json,'$.notifications.enabled')=1;
END;
-- statement-breakpoint
CREATE TABLE customer_access_tokens (
 site_id TEXT NOT NULL, token_hash TEXT NOT NULL, appointment_id TEXT NOT NULL, customer_email TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, revoked_reason TEXT,
 PRIMARY KEY(site_id,token_hash), FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE customer_management_sessions (
 site_id TEXT NOT NULL, session_hash TEXT NOT NULL, token_hash TEXT NOT NULL, appointment_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,session_hash), FOREIGN KEY(site_id,token_hash) REFERENCES customer_access_tokens(site_id,token_hash)
);
-- statement-breakpoint
CREATE TRIGGER customer_revoke_access AFTER UPDATE ON scheduling_appointments
WHEN NEW.status IN ('cancelled','declined','expired','completed','no_show') OR json_extract(NEW.customer_json,'$.email')<>json_extract(OLD.customer_json,'$.email') BEGIN
 UPDATE customer_access_tokens SET revoked_at=NEW.updated_at,revoked_reason=CASE WHEN json_extract(NEW.customer_json,'$.email')<>json_extract(OLD.customer_json,'$.email') THEN 'customer_changed' ELSE 'terminal' END
 WHERE site_id=NEW.site_id AND appointment_id=NEW.id AND revoked_at IS NULL;
END;
-- statement-breakpoint
CREATE TABLE customer_management_commands (
 site_id TEXT NOT NULL, command_key TEXT NOT NULL, session_hash TEXT NOT NULL, appointment_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('cancel','reschedule')), expected_revision INTEGER NOT NULL,
 appointment_revision INTEGER NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,command_key)
);
-- statement-breakpoint
CREATE TRIGGER customer_management_guard BEFORE INSERT ON customer_management_commands BEGIN
 SELECT RAISE(ABORT,'customer_access_denied') WHERE NOT EXISTS(
  SELECT 1 FROM customer_management_sessions m JOIN customer_access_tokens t ON t.site_id=m.site_id AND t.token_hash=m.token_hash
  JOIN scheduling_appointments a ON a.site_id=m.site_id AND a.id=m.appointment_id
  WHERE m.site_id=NEW.site_id AND m.session_hash=NEW.session_hash AND m.appointment_id=NEW.appointment_id
  AND m.expires_at>unixepoch()*1000 AND t.expires_at>unixepoch()*1000 AND t.revoked_at IS NULL
  AND t.customer_email=json_extract(a.customer_json,'$.email')
 );
 SELECT RAISE(ABORT,'scheduling_stale_revision') WHERE NOT EXISTS(SELECT 1 FROM scheduling_state s JOIN scheduling_appointments a ON a.site_id=s.site_id WHERE s.site_id=NEW.site_id AND s.revision=NEW.expected_revision AND a.id=NEW.appointment_id AND a.revision=NEW.appointment_revision);
 SELECT RAISE(ABORT,'customer_action_unavailable') WHERE NOT EXISTS(
  SELECT 1 FROM scheduling_appointments a JOIN scheduling_state s ON s.site_id=a.site_id
  WHERE a.site_id=NEW.site_id AND a.id=NEW.appointment_id AND a.status IN ('confirmed','pending_approval')
  AND (a.expires_at IS NULL OR a.expires_at>unixepoch()*1000)
  AND json_extract(s.config_json,'$.customerManagement.enabled')=1 AND json_extract(a.snapshot_json,'$.customerManagement.enabled')=1
  AND a.starts_at>unixepoch()*1000+60000*CASE NEW.kind WHEN 'cancel' THEN json_extract(a.snapshot_json,'$.customerManagement.cancellationCutoffMinutes') ELSE json_extract(a.snapshot_json,'$.customerManagement.rescheduleCutoffMinutes') END
  AND (NEW.kind='cancel' OR json_extract(s.config_json,'$.mode')='test')
 );
 UPDATE scheduling_state SET revision=revision+1 WHERE site_id=NEW.site_id;
END;
-- statement-breakpoint
CREATE TABLE scheduling_system_history (
 site_id TEXT NOT NULL, appointment_id TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,appointment_id,revision), FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE notification_fences (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL, outbox_id TEXT NOT NULL, lease_id TEXT NOT NULL, appointment_revision INTEGER NOT NULL, created_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE TRIGGER notification_fence_guard BEFORE INSERT ON notification_fences BEGIN
 SELECT RAISE(ABORT,'notification_stale') WHERE NOT EXISTS(SELECT 1 FROM scheduling_notification_outbox o JOIN scheduling_appointments a ON a.site_id=o.site_id AND a.id=o.appointment_id WHERE o.site_id=NEW.site_id AND o.id=NEW.outbox_id AND o.lease_id=NEW.lease_id AND o.lease_until>unixepoch()*1000 AND a.revision=NEW.appointment_revision);
END;
-- statement-breakpoint
CREATE TABLE scheduling_expiry_guards (id TEXT PRIMARY KEY,site_id TEXT NOT NULL,expected_revision INTEGER NOT NULL,created_at INTEGER NOT NULL);
-- statement-breakpoint
CREATE TRIGGER scheduling_expiry_guard BEFORE INSERT ON scheduling_expiry_guards BEGIN
 SELECT RAISE(ABORT,'scheduling_stale_revision') WHERE NOT EXISTS(SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.expected_revision);
 UPDATE scheduling_state SET revision=revision+1 WHERE site_id=NEW.site_id;
END;
-- statement-breakpoint
CREATE TABLE notification_admin_commands (id TEXT PRIMARY KEY,site_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,created_at INTEGER NOT NULL);
-- statement-breakpoint
CREATE TRIGGER notification_admin_authority BEFORE INSERT ON notification_admin_commands BEGIN
 SELECT RAISE(ABORT,'notification_forbidden') WHERE NOT EXISTS(
  SELECT 1 FROM users u JOIN scheduling_state s ON s.site_id=NEW.site_id WHERE u.id=NEW.user_id AND u.active=1
  AND (u.role IN ('owner','administrator') OR EXISTS(SELECT 1 FROM json_each(s.config_json,'$.grants') g,json_each(g.value,'$.permissions') p WHERE json_extract(g.value,'$.userId')=u.id AND p.value='scheduling:configure'))
 );
END;
