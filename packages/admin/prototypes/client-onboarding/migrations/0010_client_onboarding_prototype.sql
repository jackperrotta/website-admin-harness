-- Optional local-only prospect portal. Never apply as a core migration.
CREATE TABLE IF NOT EXISTS client_onboarding_prospects (
  site_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  admin_origin TEXT NOT NULL,
  id TEXT NOT NULL,
  business TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  preview_url TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','invited','active','revoked')),
  created_at TEXT NOT NULL,
  invited_at TEXT,
  expires_at INTEGER,
  activated_at TEXT,
  invite_digest TEXT,
  credential TEXT,
  feedback TEXT NOT NULL DEFAULT '',
  feedback_at TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  requires_payment INTEGER NOT NULL DEFAULT 1 CHECK(requires_payment IN (0,1)),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('not_requested','pending','demo_complete')),
  PRIMARY KEY(site_id,installation_id,admin_origin,id),
  UNIQUE(site_id,installation_id,admin_origin,email)
);
CREATE TABLE IF NOT EXISTS client_onboarding_sessions (
  site_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  admin_origin TEXT NOT NULL,
  digest TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(site_id,installation_id,admin_origin,digest),
  FOREIGN KEY(site_id,installation_id,admin_origin,prospect_id)
    REFERENCES client_onboarding_prospects(site_id,installation_id,admin_origin,id)
);
