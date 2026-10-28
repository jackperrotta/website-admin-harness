# Harness data connection

Use `npx --yes @tryvitris/website-admin-harness@alpha setup --site WEBSITE --dir NEW_ADMIN --domain ADMIN_HOST --website HTTPS_ORIGIN --backend-origin HTTPS_BACKEND --tenant EXISTING_TENANT --plan`, review the plan, then repeat with `--apply` and a dedicated VITRIS_ADMIN_API_TOKEN in the environment. This scaffolds the admin, records public connection metadata, and prepares an ignored hashed backend grant without changing forms or the backend URL. Cloudflare provisioning, grant installation, authentication onboarding and deployment remain explicit. The backend must already implement the Vitris admin v1 API; older website-harness deployments may require a separate backend upgrade.

`admin.config.json` may contain `backend: {provider: "vitris-harness", origin: "https://BACKEND", tenantId: "TENANT"}`. The Worker reads `HARNESS_API_TOKEN` from its secret environment. Never put that credential in a manifest, public asset, URL, browser request or source file.

The backend's `ADMIN_CONNECTIONS` map holds an installation-keyed grant with the matching token hash, tenant ID, exact website origin, and scopes. Preserve the complete map when merging grants. Revocation removes the entry or replaces its hash. Do not reuse a forms setup or deployment token. Upload secrets using Wrangler stdin or the secret API, never command arguments or tool output.

Leads and analytics are read from the authoritative backend. The adapter refuses redirects, verifies installation/tenant/origin identity and contract version, bounds responses and timeouts, and surfaces failures without a local-data fallback. A separate optional `leads:write` grant permits status changes after the signed-in user's role and CSRF checks. It does not authorize notification retries or recipient changes.

Generated local manifests omit production backend connections; remote connections disable demo login. Local isolated backends can be used for acceptance tests with synthetic records. Do not label records synthetic when they came from a real configured backend, and never label a configured-but-failed connection healthy.

A site with no registered backend or collecting form has no historical records to import. Prepare its collection and domain prerequisites separately, preserving existing download-only/contact behavior until its owner selects the new flow.

Use the explicit Test submissions view when validating forms. `/leads?mode=test` reads the backend's isolated test records and notification captures. Those rows are always read-only and never enter production lead or conversion counts. Automated acceptance fixtures must state when widget execution and Siteverify are stubbed; they do not prove that the live Cloudflare challenge has passed.
