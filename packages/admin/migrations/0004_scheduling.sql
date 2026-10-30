-- Scheduling is disabled until explicitly configured. No existing tables are rewritten.
-- statement-breakpoint
CREATE TABLE scheduling_state (
  site_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  updated_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE TABLE scheduling_commands (
  site_id TEXT NOT NULL REFERENCES scheduling_state(site_id),
  command_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('configuration','availability','appointment')),
  request_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
  targets_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(targets_json) AND json_type(targets_json)='array'),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, command_key)
);
-- statement-breakpoint
CREATE TRIGGER scheduling_command_guard BEFORE INSERT ON scheduling_commands BEGIN
  SELECT RAISE(ABORT, 'scheduling_stale_revision') WHERE NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.expected_revision
  );
  SELECT RAISE(ABORT, 'scheduling_access_denied') WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id=NEW.actor_id AND u.active=1 AND (
      u.role IN ('owner','administrator') OR EXISTS (
        SELECT 1 FROM scheduling_state s, json_each(s.config_json, '$.grants') g, json_each(g.value, '$.permissions') p
        WHERE s.site_id=NEW.site_id AND json_extract(g.value, '$.userId')=u.id
        AND p.value=CASE NEW.kind WHEN 'configuration' THEN 'scheduling:configure' WHEN 'availability' THEN 'availability:write' ELSE 'appointments:write' END
        AND (json_extract(g.value, '$.scope')='all' OR (
          NEW.kind<>'configuration' AND json_array_length(NEW.targets_json)>0 AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.targets_json) target WHERE NOT EXISTS (
              SELECT 1 FROM json_each(s.config_json, '$.resources') resource
              WHERE json_extract(resource.value, '$.id')=target.value
              AND json_extract(resource.value, '$.kind')='provider'
              AND json_extract(resource.value, '$.userId')=u.id
            )
          )
        ))
      )
    )
  );
  UPDATE scheduling_state SET revision=revision+1, updated_at=NEW.created_at WHERE site_id=NEW.site_id;
END;
-- statement-breakpoint
CREATE TABLE scheduling_appointments (
  site_id TEXT NOT NULL REFERENCES scheduling_state(site_id),
  id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
  occupied_starts_at INTEGER NOT NULL CHECK(occupied_starts_at <= starts_at),
  occupied_ends_at INTEGER NOT NULL CHECK(occupied_ends_at >= ends_at),
  status TEXT NOT NULL CHECK(status IN ('pending_approval','confirmed','declined','expired','cancelled','completed','no_show')),
  expires_at INTEGER,
  customer_json TEXT NOT NULL CHECK(json_valid(customer_json)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json,'$.resourceIds') IS 'array' AND json_array_length(snapshot_json,'$.resourceIds') BETWEEN 1 AND 8),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  schedule_revision INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'test' CHECK(mode='test'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,id),
  CHECK((status='pending_approval' AND expires_at IS NOT NULL) OR (status<>'pending_approval' AND expires_at IS NULL))
);
-- statement-breakpoint
CREATE INDEX scheduling_appointments_range ON scheduling_appointments(site_id,starts_at,provider_id);
-- statement-breakpoint
CREATE TABLE scheduling_reservations (
  site_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
  expires_at INTEGER,
  PRIMARY KEY(site_id,appointment_id,resource_id),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE INDEX scheduling_reservations_overlap ON scheduling_reservations(site_id,resource_id,starts_at,ends_at);
-- statement-breakpoint
CREATE TRIGGER scheduling_reservation_insert BEFORE INSERT ON scheduling_reservations BEGIN
  SELECT RAISE(ABORT, 'scheduling_resource_conflict') WHERE EXISTS (
    SELECT 1 FROM scheduling_reservations r WHERE r.site_id=NEW.site_id AND r.resource_id=NEW.resource_id
    AND r.appointment_id<>NEW.appointment_id AND (r.expires_at IS NULL OR r.expires_at>unixepoch()*1000)
    AND NEW.starts_at<r.ends_at AND NEW.ends_at>r.starts_at
  );
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_reservation_update BEFORE UPDATE ON scheduling_reservations BEGIN
  SELECT RAISE(ABORT, 'scheduling_resource_conflict') WHERE EXISTS (
    SELECT 1 FROM scheduling_reservations r WHERE r.site_id=NEW.site_id AND r.resource_id=NEW.resource_id
    AND r.appointment_id<>OLD.appointment_id AND (r.expires_at IS NULL OR r.expires_at>unixepoch()*1000)
    AND NEW.starts_at<r.ends_at AND NEW.ends_at>r.starts_at
  );
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_appointment_insert_guard BEFORE INSERT ON scheduling_appointments BEGIN
  SELECT RAISE(ABORT, 'scheduling_invalid_snapshot') WHERE NOT EXISTS (
    SELECT 1 FROM json_each(NEW.snapshot_json,'$.resourceIds') WHERE type='text' AND value=NEW.provider_id
  );
  SELECT RAISE(ABORT, 'scheduling_disabled') WHERE NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND json_extract(config_json, '$.mode')='test'
  );
  SELECT RAISE(ABORT, 'scheduling_stale_revision') WHERE NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.schedule_revision
  );
  SELECT RAISE(ABORT, 'scheduling_expired') WHERE NEW.status='pending_approval' AND NEW.expires_at<=unixepoch()*1000;
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_appointment_update_guard BEFORE UPDATE ON scheduling_appointments BEGIN
  SELECT RAISE(ABORT, 'scheduling_invalid_snapshot') WHERE NOT EXISTS (
    SELECT 1 FROM json_each(NEW.snapshot_json,'$.resourceIds') WHERE type='text' AND value=NEW.provider_id
  );
  SELECT RAISE(ABORT, 'scheduling_disabled') WHERE (NEW.starts_at<>OLD.starts_at OR NEW.provider_id<>OLD.provider_id OR NEW.location_id<>OLD.location_id) AND NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND json_extract(config_json, '$.mode')='test'
  );
  SELECT RAISE(ABORT, 'scheduling_stale_revision') WHERE NEW.site_id<>OLD.site_id OR NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.schedule_revision
  );
  SELECT RAISE(ABORT, 'scheduling_expired') WHERE OLD.status='pending_approval' AND OLD.expires_at<=unixepoch()*1000 AND NEW.status NOT IN ('expired','cancelled');
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_appointment_insert_claims AFTER INSERT ON scheduling_appointments BEGIN
  INSERT INTO scheduling_reservations(site_id,appointment_id,resource_id,starts_at,ends_at,expires_at)
  SELECT NEW.site_id,NEW.id,value,NEW.occupied_starts_at,NEW.occupied_ends_at,NEW.expires_at
  FROM json_each(NEW.snapshot_json,'$.resourceIds') WHERE NEW.status IN ('pending_approval','confirmed');
END;
-- statement-breakpoint
CREATE TRIGGER scheduling_appointment_update_claims AFTER UPDATE ON scheduling_appointments BEGIN
  DELETE FROM scheduling_reservations WHERE site_id=OLD.site_id AND appointment_id=OLD.id;
  INSERT INTO scheduling_reservations(site_id,appointment_id,resource_id,starts_at,ends_at,expires_at)
  SELECT NEW.site_id,NEW.id,value,NEW.occupied_starts_at,NEW.occupied_ends_at,NEW.expires_at
  FROM json_each(NEW.snapshot_json,'$.resourceIds') WHERE NEW.status IN ('pending_approval','confirmed');
END;
-- statement-breakpoint
CREATE TABLE scheduling_history (
  site_id TEXT NOT NULL REFERENCES scheduling_state(site_id),
  id TEXT NOT NULL,
  appointment_id TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,id),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE scheduling_jobs (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  appointment_revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('notification','calendar')),
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured' CHECK(status='captured'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,id),
  UNIQUE(site_id,appointment_id,appointment_revision,kind),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
