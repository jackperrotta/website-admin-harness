-- Optional local client-onboarding variant only. Existing prospect records remain intact.
ALTER TABLE client_onboarding_prospects ADD COLUMN onboarding_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE client_onboarding_prospects ADD COLUMN onboarding_draft TEXT NOT NULL DEFAULT '{}';
CREATE TABLE client_onboarding_templates (
  site_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  admin_origin TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  PRIMARY KEY(site_id,installation_id,admin_origin,id)
);
