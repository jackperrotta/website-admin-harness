-- Optional local prototype only. Not part of ordinary installation migrations.
CREATE TABLE client_portfolio_prototype (
  site_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  payload TEXT NOT NULL
);
