# Optional existing-account password compatibility

Magic-link authentication remains the default for new installations. An existing business account can retain its identity and compatible password verifier during an explicitly planned migration. Enable PASSWORD_LOGIN=1 and retain PASSWORD_PEPPER as a server-side Cloudflare secret. Apply additive migration 0003, importing only supported PBKDF2-SHA256 (100,000 iterations, 256 or 1536 derived bits) plus HMAC-SHA256 verifier records. The pepper must match the original deployment. Neither hashes nor peppers belong in the open-source package or client assets.

The runtime does not expose password enrollment or reset. Complete enrollment in the authoritative existing application before cutover if no credential exists. Reconcile the provisional bootstrap identity to the authoritative active owner rather than creating a second account. Preserve the old database and deployment for recovery. Do not transfer sessions; the owner signs into the replacement with their existing password.

The password endpoint enforces canonical host, same-origin POST, bounded input, email/source rate limits, neutral credential failures, and active-user checks. Unknown users execute the same current verifier workload. All subsequent requests load current user activity/role from D1, so revocation applies immediately. Production demo login stays disabled.
