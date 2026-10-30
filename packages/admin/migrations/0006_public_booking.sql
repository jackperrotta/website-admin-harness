-- Public guest commands have independent authority; they never impersonate admin users.
-- statement-breakpoint
CREATE TABLE booking_commands (
 site_id TEXT NOT NULL REFERENCES scheduling_state(site_id), command_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 expected_revision INTEGER NOT NULL, service_id TEXT NOT NULL, origin TEXT NOT NULL,
 appointment_id TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,command_key)
);
-- statement-breakpoint
CREATE TRIGGER booking_command_guard BEFORE INSERT ON booking_commands BEGIN
 SELECT RAISE(ABORT,'scheduling_stale_revision') WHERE NOT EXISTS(SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'booking_disabled') WHERE NOT EXISTS(
  SELECT 1 FROM scheduling_state s, json_each(s.config_json,'$.publicBooking.serviceIds') published
  WHERE s.site_id=NEW.site_id AND json_extract(s.config_json,'$.mode')='test'
  AND json_extract(s.config_json,'$.publicBooking.enabled')=1 AND published.value=NEW.service_id
 );
 UPDATE scheduling_state SET revision=revision+1 WHERE site_id=NEW.site_id;
END;
-- statement-breakpoint
CREATE TABLE booking_history (
 site_id TEXT NOT NULL, appointment_id TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,appointment_id,revision), FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE booking_rate_limits (
 site_id TEXT NOT NULL, key_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,key_hash,bucket)
);
-- statement-breakpoint
CREATE INDEX booking_limits_expiry ON booking_rate_limits(expires_at);
