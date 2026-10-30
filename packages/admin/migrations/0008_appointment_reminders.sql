-- Reminder timing is opt-in; no historical email is queued by this migration.
-- statement-breakpoint
ALTER TABLE scheduling_notification_outbox ADD COLUMN reminder_offset_minutes INTEGER;
-- statement-breakpoint
ALTER TABLE scheduling_notification_outbox ADD COLUMN reminder_starts_at INTEGER;
-- statement-breakpoint
ALTER TABLE scheduling_notification_outbox ADD COLUMN reminder_send_started_at INTEGER;
-- statement-breakpoint
CREATE TABLE scheduling_reminder_windows (
 site_id TEXT NOT NULL, appointment_id TEXT NOT NULL, starts_at INTEGER NOT NULL, eligible_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,appointment_id), FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
INSERT INTO scheduling_reminder_windows(site_id,appointment_id,starts_at,eligible_at)
 SELECT site_id,id,starts_at,unixepoch()*1000 FROM scheduling_appointments WHERE status='confirmed' AND starts_at>unixepoch()*1000;
-- statement-breakpoint
CREATE TRIGGER scheduling_reminder_created AFTER INSERT ON scheduling_appointments WHEN NEW.status='confirmed' BEGIN
 INSERT INTO scheduling_reminder_windows(site_id,appointment_id,starts_at,eligible_at) VALUES(NEW.site_id,NEW.id,NEW.starts_at,NEW.updated_at);
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_reminder_changed AFTER UPDATE ON scheduling_appointments
WHEN NEW.status='confirmed' AND (OLD.status<>'confirmed' OR NEW.starts_at<>OLD.starts_at OR NEW.provider_id<>OLD.provider_id OR NEW.location_id<>OLD.location_id OR NEW.customer_json<>OLD.customer_json) BEGIN
 INSERT INTO scheduling_reminder_windows(site_id,appointment_id,starts_at,eligible_at) VALUES(NEW.site_id,NEW.id,NEW.starts_at,NEW.updated_at)
 ON CONFLICT(site_id,appointment_id) DO UPDATE SET starts_at=excluded.starts_at,eligible_at=excluded.eligible_at;
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_reminder_settings AFTER UPDATE ON scheduling_state
WHEN coalesce(json_extract(NEW.config_json,'$.notifications'),'')<>coalesce(json_extract(OLD.config_json,'$.notifications'),'') BEGIN
 UPDATE scheduling_reminder_windows SET eligible_at=NEW.updated_at WHERE site_id=NEW.site_id;
END;
-- statement-breakpoint
CREATE VIEW scheduling_due_reminders AS
 SELECT a.site_id,a.id AS appointment_id,a.revision,a.starts_at,r.value AS offset_minutes,
 a.starts_at-60000*r.value AS due_at,json_extract(s.config_json,'$.notifications.mode') AS mode,
 json_object('id',a.id,'service_id',a.service_id,'provider_id',a.provider_id,'location_id',a.location_id,'starts_at',a.starts_at,'ends_at',a.ends_at,'occupied_starts_at',a.occupied_starts_at,'occupied_ends_at',a.occupied_ends_at,'status',a.status,'expires_at',a.expires_at,'customer_json',a.customer_json,'snapshot_json',a.snapshot_json,'revision',a.revision) AS payload_json
 FROM scheduling_appointments a JOIN scheduling_state s ON s.site_id=a.site_id
 JOIN scheduling_reminder_windows w ON w.site_id=a.site_id AND w.appointment_id=a.id AND w.starts_at=a.starts_at,
 json_each(s.config_json,'$.notifications.reminders.offsetsMinutes') r
 WHERE a.status='confirmed' AND a.starts_at>unixepoch()*1000
 AND json_extract(s.config_json,'$.notifications.enabled')=1 AND json_extract(s.config_json,'$.notifications.reminders.enabled')=1
 AND r.type='integer' AND r.value BETWEEN 1 AND 43200
 AND w.eligible_at<=a.starts_at-60000*r.value
 AND a.starts_at-60000*r.value<=unixepoch()*1000 AND a.starts_at-60000*r.value>unixepoch()*1000-900000;
-- statement-breakpoint
CREATE TRIGGER scheduling_reminder_fence BEFORE INSERT ON notification_fences
WHEN EXISTS(SELECT 1 FROM scheduling_notification_outbox WHERE site_id=NEW.site_id AND id=NEW.outbox_id AND kind='reminder') BEGIN
 SELECT RAISE(ABORT,'notification_stale') WHERE NOT EXISTS(
  SELECT 1 FROM scheduling_notification_outbox o JOIN scheduling_due_reminders d ON d.site_id=o.site_id AND d.appointment_id=o.appointment_id
  AND d.starts_at=o.reminder_starts_at AND d.offset_minutes=o.reminder_offset_minutes AND d.mode=o.mode AND d.revision=o.appointment_revision
  WHERE o.site_id=NEW.site_id AND o.id=NEW.outbox_id
 );
END;
