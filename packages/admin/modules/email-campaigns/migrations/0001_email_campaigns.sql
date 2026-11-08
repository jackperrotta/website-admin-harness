-- Additive, optional module schema. No recipient enrollment or mail is created.
CREATE TABLE email_records (site_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, data_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(site_id,kind,id));
CREATE INDEX email_records_kind ON email_records(site_id,kind,updated_at,id);
CREATE INDEX email_records_status ON email_records(site_id,kind,json_extract(data_json,'$.status'),updated_at);
CREATE TABLE email_contacts (site_id TEXT NOT NULL,id TEXT NOT NULL,email_key TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,company TEXT NOT NULL,stage TEXT NOT NULL,tags_json TEXT NOT NULL,fields_json TEXT NOT NULL,source TEXT NOT NULL,interaction_ref TEXT NOT NULL,service_ref TEXT NOT NULL,evidence TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER,PRIMARY KEY(site_id,id),UNIQUE(site_id,email_key));
CREATE INDEX email_contacts_audience ON email_contacts(site_id,deleted_at,id,created_at);
CREATE INDEX email_contacts_stage ON email_contacts(site_id,stage,source);
CREATE TABLE email_preferences (site_id TEXT NOT NULL,contact_id TEXT NOT NULL,topic TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('subscribed','unsubscribed')),evidence_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(site_id,contact_id,topic));
CREATE TABLE email_suppressions (site_id TEXT NOT NULL,email_key TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(site_id,email_key));
CREATE TABLE email_jobs (site_id TEXT NOT NULL,id TEXT NOT NULL,campaign_id TEXT NOT NULL DEFAULT '',contact_id TEXT NOT NULL,purpose TEXT NOT NULL,topic TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('capture','send')),state TEXT NOT NULL,due_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,payload_cipher TEXT NOT NULL,message_cipher TEXT,provider_message_id TEXT,reason TEXT,actor_id TEXT NOT NULL,PRIMARY KEY(site_id,id));
CREATE INDEX email_jobs_due ON email_jobs(site_id,state,due_at,lease_until);
CREATE UNIQUE INDEX email_jobs_provider ON email_jobs(site_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_jobs_campaign ON email_jobs(site_id,campaign_id,state);
CREATE INDEX email_jobs_contact ON email_jobs(site_id,contact_id,created_at);
CREATE TABLE email_events (site_id TEXT NOT NULL,id TEXT NOT NULL,type TEXT NOT NULL,provider_message_id TEXT,contact_id TEXT NOT NULL DEFAULT '',payload_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(site_id,id));
CREATE INDEX email_events_message ON email_events(site_id,provider_message_id,created_at);
CREATE TABLE email_enrollments (site_id TEXT NOT NULL,id TEXT NOT NULL,automation_id TEXT NOT NULL,version_id TEXT NOT NULL,contact_id TEXT NOT NULL,event_id TEXT NOT NULL,step INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'active',due_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,context_cipher TEXT NOT NULL,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(site_id,id),UNIQUE(site_id,automation_id,event_id,contact_id));
CREATE INDEX email_enrollments_due ON email_enrollments(site_id,state,due_at,lease_until);
CREATE TABLE email_tokens (site_id TEXT NOT NULL,digest TEXT NOT NULL,contact_id TEXT NOT NULL,purpose TEXT NOT NULL,topic TEXT NOT NULL,email_key TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER,PRIMARY KEY(site_id,digest));
CREATE INDEX email_tokens_expiry ON email_tokens(site_id,expires_at);
CREATE TABLE email_limits (site_id TEXT NOT NULL,bucket TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,PRIMARY KEY(site_id,bucket));
CREATE INDEX email_limits_expiry ON email_limits(site_id,expires_at);
CREATE TABLE email_imports (site_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,state TEXT NOT NULL,payload_cipher TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(site_id,id),UNIQUE(site_id,digest));
CREATE TABLE email_import_chunks (site_id TEXT NOT NULL,import_id TEXT NOT NULL,chunk_no INTEGER NOT NULL,payload_cipher TEXT NOT NULL,PRIMARY KEY(site_id,import_id,chunk_no));
CREATE TABLE email_assets (site_id TEXT NOT NULL,id TEXT NOT NULL,r2_key TEXT NOT NULL,type TEXT NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(site_id,id));
CREATE TABLE email_clicks (site_id TEXT NOT NULL,id TEXT NOT NULL,job_id TEXT NOT NULL,url TEXT NOT NULL,click_count INTEGER NOT NULL DEFAULT 0,first_clicked_at INTEGER,PRIMARY KEY(site_id,id));
CREATE TABLE email_daily (site_id TEXT NOT NULL,day TEXT NOT NULL,kind TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(site_id,day,kind));
CREATE TABLE email_send_reservations (site_id TEXT NOT NULL,job_id TEXT NOT NULL,contact_id TEXT NOT NULL,mode TEXT NOT NULL,created_at INTEGER NOT NULL,per_minute INTEGER NOT NULL,daily_limit INTEGER NOT NULL,monthly_limit INTEGER NOT NULL,spacing_ms INTEGER NOT NULL,PRIMARY KEY(site_id,job_id));
CREATE INDEX email_reservations_time ON email_send_reservations(site_id,mode,created_at);
CREATE INDEX email_reservations_contact ON email_send_reservations(site_id,contact_id,mode,created_at);
-- statement-breakpoint
CREATE TRIGGER email_reservation_limits BEFORE INSERT ON email_send_reservations
WHEN NOT EXISTS(SELECT 1 FROM email_send_reservations WHERE site_id=NEW.site_id AND job_id=NEW.job_id)
BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM email_send_reservations WHERE site_id=NEW.site_id AND mode=NEW.mode AND created_at>=NEW.created_at-60000)>=NEW.per_minute THEN RAISE(ABORT,'email_quota') END;
 SELECT CASE WHEN (SELECT count(*) FROM email_send_reservations WHERE site_id=NEW.site_id AND mode=NEW.mode AND created_at>=CAST(NEW.created_at/86400000 AS INTEGER)*86400000)>=NEW.daily_limit THEN RAISE(ABORT,'email_daily_quota') END;
 SELECT CASE WHEN (SELECT count(*) FROM email_send_reservations WHERE site_id=NEW.site_id AND mode=NEW.mode AND created_at>=CAST(strftime('%s',NEW.created_at/1000,'unixepoch','start of month') AS INTEGER)*1000)>=NEW.monthly_limit THEN RAISE(ABORT,'email_monthly_quota') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM email_send_reservations WHERE site_id=NEW.site_id AND contact_id=NEW.contact_id AND mode=NEW.mode AND created_at>NEW.created_at-NEW.spacing_ms) THEN RAISE(ABORT,'email_frequency') END;
END;
