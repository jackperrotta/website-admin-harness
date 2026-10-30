-- Calendar integration is opt-in; existing scheduling configuration and records stay intact.
-- statement-breakpoint
CREATE TABLE calendar_connections (
  site_id TEXT NOT NULL REFERENCES scheduling_state(site_id), id TEXT NOT NULL,
  resource_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
  created_by TEXT NOT NULL REFERENCES users(id), account_id TEXT NOT NULL, account_label TEXT NOT NULL,
  tokens_cipher TEXT, selection_json TEXT NOT NULL DEFAULT '{"blocking":[],"destination":null}' CHECK(json_valid(selection_json)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  health TEXT NOT NULL DEFAULT 'disconnected' CHECK(health IN ('disconnected','healthy','stale','reauthorization_required','error')),
  revision INTEGER NOT NULL DEFAULT 0, current_batch TEXT, snapshot_hash TEXT,
  last_synced_at INTEGER, range_start INTEGER, range_end INTEGER, next_sync_at INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,id)
);
-- statement-breakpoint
CREATE UNIQUE INDEX calendar_connected_account ON calendar_connections(site_id,resource_id,provider) WHERE tokens_cipher IS NOT NULL;
-- statement-breakpoint
CREATE TABLE calendar_oauth_flows (
  state_hash TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES scheduling_state(site_id),
  user_id TEXT NOT NULL REFERENCES users(id), resource_id TEXT NOT NULL, provider TEXT NOT NULL,
  connection_id TEXT NOT NULL, cookie_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE TABLE calendar_busy_intervals (
  site_id TEXT NOT NULL, connection_id TEXT NOT NULL, batch_id TEXT NOT NULL, event_key TEXT NOT NULL,
  resource_id TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
  PRIMARY KEY(site_id,connection_id,batch_id,event_key),
  FOREIGN KEY(site_id,connection_id) REFERENCES calendar_connections(site_id,id) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE INDEX calendar_busy_overlap ON calendar_busy_intervals(site_id,resource_id,starts_at,ends_at);
-- statement-breakpoint
CREATE TABLE calendar_event_links (
  site_id TEXT NOT NULL, connection_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL, external_id TEXT, marker TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
  exported_revision INTEGER NOT NULL DEFAULT 0, payload_hash TEXT, remote_etag TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted','conflict')),
  PRIMARY KEY(site_id,connection_id,appointment_id),
  FOREIGN KEY(site_id,connection_id) REFERENCES calendar_connections(site_id,id),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE calendar_export_jobs (
  site_id TEXT NOT NULL, connection_id TEXT NOT NULL, appointment_id TEXT NOT NULL, appointment_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,connection_id,appointment_id,appointment_revision),
  FOREIGN KEY(site_id,connection_id) REFERENCES calendar_connections(site_id,id),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
-- statement-breakpoint
CREATE TABLE calendar_mutations (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES scheduling_state(site_id),
  user_id TEXT NOT NULL REFERENCES users(id), resource_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  connection_id TEXT, expected_revision INTEGER, lease_id TEXT
);
-- statement-breakpoint
CREATE TRIGGER calendar_mutation_authority BEFORE INSERT ON calendar_mutations BEGIN
  SELECT RAISE(ABORT,'calendar_stale_connection') WHERE NEW.connection_id IS NOT NULL AND (
    (NEW.expected_revision=-1 AND EXISTS(SELECT 1 FROM calendar_connections WHERE site_id=NEW.site_id AND id=NEW.connection_id))
    OR (NEW.expected_revision>=0 AND NOT EXISTS(SELECT 1 FROM calendar_connections WHERE site_id=NEW.site_id AND id=NEW.connection_id AND revision=NEW.expected_revision AND (lease_until<=unixepoch()*1000 OR lease_id=NEW.lease_id)))
  );
  SELECT RAISE(ABORT,'calendar_forbidden') WHERE NOT EXISTS (
    SELECT 1 FROM users u, scheduling_state s
    WHERE s.site_id=NEW.site_id AND u.id=NEW.user_id AND u.active=1
    AND (u.role IN ('owner','administrator') OR EXISTS (
      SELECT 1 FROM json_each(s.config_json,'$.grants') g, json_each(g.value,'$.permissions') p, json_each(s.config_json,'$.resources') r
      WHERE json_extract(g.value,'$.userId')=u.id AND p.value='calendar-connections:manage'
      AND json_extract(r.value,'$.id')=NEW.resource_id AND json_extract(r.value,'$.kind')='provider'
      AND (json_extract(g.value,'$.scope')='all' OR json_extract(r.value,'$.userId')=u.id)
    ))
  );
END;
-- statement-breakpoint
CREATE TRIGGER calendar_external_overlap BEFORE INSERT ON scheduling_reservations BEGIN
  SELECT RAISE(ABORT,'calendar_busy') WHERE EXISTS (
    SELECT 1 FROM calendar_busy_intervals b JOIN calendar_connections c
    ON c.site_id=b.site_id AND c.id=b.connection_id AND c.current_batch=b.batch_id
    WHERE b.site_id=NEW.site_id AND b.resource_id=NEW.resource_id AND c.enabled=1
    AND NEW.starts_at<b.ends_at AND NEW.ends_at>b.starts_at
  );
END;
-- statement-breakpoint
CREATE TRIGGER calendar_booking_health BEFORE INSERT ON scheduling_appointments BEGIN
  SELECT RAISE(ABORT,'calendar_unavailable') WHERE EXISTS (
    SELECT 1 FROM calendar_connections c WHERE c.site_id=NEW.site_id AND c.resource_id=NEW.provider_id AND c.enabled=1
    AND (c.health<>'healthy' OR c.last_synced_at IS NULL OR c.last_synced_at<(unixepoch()*1000-180000)
      OR c.range_start>NEW.occupied_starts_at OR c.range_end<NEW.occupied_ends_at
      OR EXISTS(SELECT 1 FROM calendar_export_jobs j WHERE j.site_id=c.site_id AND j.connection_id=c.id AND j.status IN ('pending','running','failed')))
  );
END;
-- statement-breakpoint
CREATE TRIGGER calendar_reschedule_health BEFORE UPDATE ON scheduling_appointments
WHEN NEW.starts_at<>OLD.starts_at OR NEW.provider_id<>OLD.provider_id OR NEW.location_id<>OLD.location_id OR (OLD.status='pending_approval' AND NEW.status='confirmed') BEGIN
  SELECT RAISE(ABORT,'calendar_unavailable') WHERE EXISTS (
    SELECT 1 FROM calendar_connections c WHERE c.site_id=NEW.site_id AND c.resource_id=NEW.provider_id AND c.enabled=1
    AND (c.health<>'healthy' OR c.last_synced_at IS NULL OR c.last_synced_at<(unixepoch()*1000-180000)
      OR c.range_start>NEW.occupied_starts_at OR c.range_end<NEW.occupied_ends_at
      OR EXISTS(SELECT 1 FROM calendar_export_jobs j WHERE j.site_id=c.site_id AND j.connection_id=c.id AND j.status IN ('pending','running','failed')))
  );
END;
-- statement-breakpoint
CREATE TRIGGER calendar_enqueue_created AFTER INSERT ON scheduling_appointments BEGIN
  INSERT INTO calendar_export_jobs(site_id,connection_id,appointment_id,appointment_revision,created_at,updated_at)
  SELECT NEW.site_id,c.id,NEW.id,NEW.revision,NEW.updated_at,NEW.updated_at FROM calendar_connections c
  WHERE c.site_id=NEW.site_id AND c.resource_id=NEW.provider_id AND c.enabled=1;
END;
-- statement-breakpoint
CREATE TRIGGER calendar_enqueue_changed AFTER UPDATE ON scheduling_appointments BEGIN
  INSERT INTO calendar_export_jobs(site_id,connection_id,appointment_id,appointment_revision,created_at,updated_at)
  SELECT NEW.site_id,c.id,NEW.id,NEW.revision,NEW.updated_at,NEW.updated_at FROM calendar_connections c
  WHERE c.site_id=NEW.site_id AND c.enabled=1 AND (c.resource_id=NEW.provider_id OR EXISTS (
    SELECT 1 FROM calendar_event_links l WHERE l.site_id=c.site_id AND l.connection_id=c.id AND l.appointment_id=NEW.id
  ));
END;
-- statement-breakpoint
CREATE TABLE calendar_activity (
  site_id TEXT NOT NULL, id TEXT NOT NULL, connection_id TEXT NOT NULL, appointment_id TEXT,
  action TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,id), FOREIGN KEY(site_id,connection_id) REFERENCES calendar_connections(site_id,id)
);
-- statement-breakpoint
CREATE TABLE calendar_sync_fences (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, connection_id TEXT NOT NULL, revision INTEGER NOT NULL,
  lease_id TEXT NOT NULL, schedule_revision INTEGER, created_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE TRIGGER calendar_sync_fence_guard BEFORE INSERT ON calendar_sync_fences BEGIN
  SELECT RAISE(ABORT,'calendar_stale_connection') WHERE NOT EXISTS (
    SELECT 1 FROM calendar_connections WHERE site_id=NEW.site_id AND id=NEW.connection_id
    AND revision=NEW.revision AND enabled=1 AND lease_id=NEW.lease_id AND lease_until>unixepoch()*1000
  );
  SELECT RAISE(ABORT,'scheduling_stale_revision') WHERE NEW.schedule_revision IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM scheduling_state WHERE site_id=NEW.site_id AND revision=NEW.schedule_revision
  );
END;
-- statement-breakpoint
CREATE TABLE calendar_conflicts (
  site_id TEXT NOT NULL, connection_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('external_changed','external_deleted','external_overlap')),
  created_at INTEGER NOT NULL, PRIMARY KEY(site_id,connection_id,appointment_id,reason),
  FOREIGN KEY(site_id,connection_id) REFERENCES calendar_connections(site_id,id)
);
-- statement-breakpoint
CREATE TABLE appointment_calendar_captures (
  site_id TEXT NOT NULL, appointment_id TEXT NOT NULL, appointment_revision INTEGER NOT NULL,
  attachment_json TEXT NOT NULL CHECK(json_valid(attachment_json)), created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,appointment_id,appointment_revision),
  FOREIGN KEY(site_id,appointment_id) REFERENCES scheduling_appointments(site_id,id)
);
