-- In standalone admins tenant_id is the manifest site ID. Connected admins
-- use the website backend's separately reviewed migration and authoritative data.
CREATE TABLE lead_followups (
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to TEXT CHECK(assigned_to IS NULL OR length(assigned_to) BETWEEN 1 AND 100),
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 3000),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, installation_id, lead_id)
);
CREATE INDEX lead_followups_due ON lead_followups(tenant_id, installation_id, completed, due_date);
CREATE INDEX lead_followups_assigned ON lead_followups(tenant_id, installation_id, assigned_to, completed);
