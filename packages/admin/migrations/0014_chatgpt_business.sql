CREATE TABLE chatgpt_business_status (
  installation_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  claim TEXT NOT NULL CHECK (claim IN ('not_started', 'pending', 'approved', 'needs_attention')),
  verification TEXT NOT NULL CHECK (verification IN ('not_started', 'pending', 'approved', 'needs_attention')),
  agent TEXT NOT NULL CHECK (agent IN ('not_started', 'draft', 'published', 'unavailable')),
  last_checked TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (installation_id, site_id)
);
