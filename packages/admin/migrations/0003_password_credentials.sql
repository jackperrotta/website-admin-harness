-- Optional imported account credentials; the pepper remains a deployment secret.
CREATE TABLE password_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id), salt TEXT NOT NULL, tag TEXT NOT NULL, iterations INTEGER NOT NULL CHECK(iterations=100000), key_bits INTEGER NOT NULL CHECK(key_bits IN (256,1536)), created_at TEXT NOT NULL DEFAULT (datetime('now')));
