-- Apply separately to the owning website database after reviewing that installation.
CREATE TABLE website_email_outbox(scope TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,payload_cipher TEXT NOT NULL,due_at INTEGER NOT NULL,created_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,PRIMARY KEY(scope,id));
CREATE INDEX website_email_outbox_due ON website_email_outbox(scope,state,due_at,lease_until);
