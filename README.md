# Website Admin Harness

A standalone, open-source business website admin built around Cloudflare. Each business gets its own installation at `admin.business.com`, its own accounts and records, and explicit agent-maintained modules. This is an early alpha; production installations require explicitly configured infrastructure and authentication.

## Working directory

The standalone source lives in its own Git repository and npm workspace, separate from the website harness and customer-specific installations. Clone it as `website-admin-harness` (this workstation uses `E:\Projects\website-admin-harness`). The npm packages are `@tryvitris/website-admin-harness`, `@tryvitris/create-website-admin-harness`, and `@tryvitris/website-admin-contracts`.

Repository: [jackperrotta/website-admin-harness](https://github.com/jackperrotta/website-admin-harness).

## Local preview

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4391 and choose **Open local demo**. The demo uses synthetic enquiries and analytics in local D1. Its bypass works only with explicit local mode and the configured loopback origin. No email is sent. Customer websites are unaffected.

## Cloudflare by default

| Service | Responsibility |
| --- | --- |
| Workers with Static Assets | Same-origin UI and API on the business admin subdomain |
| D1 | Business records, sessions, atomic one-use login tokens, settings, and audit history |
| R2 | Binding prepared for later assets and export workflows; no Media section |
| Email Service | Authentication mail using a restricted sender binding |

The first supported production target is Cloudflare. Interfaces and export contracts can support other implementations later. This project does not require a central Vitris login or subscription server.

## Available in this alpha

- Branded responsive shell with Overview, Leads, Analytics, Settings, Users and access, and Activity.
- Synthetic local data; lead search/filter/detail/status changes; analytics date range; saved notification preferences with revision conflict checks.
- Work queue module with persistent task creation and completion.
- Unreleased opt-in [scheduling module](docs/SCHEDULING.md): day/week/agenda calendar, service and staff management, scoped availability, test appointments and atomic resource reservations. Google/Outlook calendar sync and calendar files are implemented in source; test-mode website bookings now use the same admin calendar.
- Trusted build-time module handlers, explicit manifest enablement, permission checks, and generic record-list UI.
- Canonical-host checks, CSRF Origin checks, D1 sessions, revocable account access, and Cloudflare email magic-link implementation.
- npm runtime, initializer and validated contracts packages; generated installation projects; owner SQL bootstrap; module scaffold and agent kit.
- A connection planner that records public admin metadata in an existing website's launch.json while preserving its forms and backend origin.

Pages, Media, arbitrary HTML editing and a page builder are outside scope. A future AI workflow will handle content and media. A configured harness connection reads authoritative production leads and analytics without copying records or replacing the form pipeline. Websites without collection must enable it separately. Saving notification preferences does not change live delivery. Invitations, ownership transfer, production rate-limit hardening, full exports/restores, and automatic cloud provisioning remain follow-up milestones. Authentication mail is tested with a provider stub; live sender onboarding/delivery is not verified.

## Packages and installation

The next public alpha release is `0.1.0-alpha.2`, distributed under the `alpha` tag. Requires Node.js 24 or newer.

- `@tryvitris/website-admin-harness`: compiled Worker runtime, UI, migrations, CLI and agent kit.
- `@tryvitris/create-website-admin-harness`: installation initializer using the runtime CLI.
- `@tryvitris/website-admin-contracts`: installation manifest validation and module/permission contracts.

Create a separate installation with `npm create @tryvitris/website-admin-harness@alpha -- --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://acme.com`.

For the current local build:

```sh
npm run build
node packages/admin/bin/admin.mjs init --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://acme.com
```

All maintained code uses strict TypeScript, including the CLI, scripts, tests, and generated installation sources. Node.js 24 or later runs repository scripts; npm packages ship compiled JavaScript entry points with declarations. The generated installation includes `worker.ts`, `worker.local.ts`, typed module scaffolds, and `npm run typecheck` / `npm run check`.

The generated installation pins the exact runtime version. Run `npm install` in the generated directory. It contains separate production and local Wrangler configurations and a copied UI release. Future package updates must also update copied UI/migrations/agent material through a reviewed diff; automatic upgrade tooling is not available yet.

Use `vitris-admin plan` to inspect setup prerequisites. It makes no cloud writes. D1/R2 creation, actual resource ownership, DNS/TLS, sender onboarding and production deployment need real account configuration. See [Cloudflare deployment](packages/admin/agent/refs/cloudflare.md).

## Website harness setup

A website agent can use the published package without a local checkout of this repository:

```sh
npx --yes @tryvitris/website-admin-harness@alpha setup --site ../acme --dir ../acme-admin --domain admin.acme.com --website https://www.acme.com --tenant EXISTING_TENANT_ID --backend-origin https://BACKEND --plan
```

Review the website's `artifacts/admin/setup-plan.json`. Set a new dedicated `VITRIS_ADMIN_API_TOKEN` in the operator environment, then repeat with `--apply`. Install the generated admin's dependencies. Repeating the same applied setup is a no-op; changed plans, unrelated existing directories, and conflicting connections are rejected.

Setup preserves existing website forms, backend URL, pages and workflow state. It saves only the token hash in the installation's ignored `.vitris/backend-grant.json`. Merge that grant into the backend's complete `ADMIN_CONNECTIONS` map and upload the raw credential to this admin as `HARNESS_API_TOKEN` through secret stdin. Default scopes are `leads:read` and `analytics:read`; use `--lead-write` during both planning and applying only when status changes are intended.

The backend must already implement the Vitris admin v1 API. Setup does not add that API to an older website-harness deployment, create Cloudflare resources, enable form/analytics collection, migrate production data, configure authentication mail, or deploy either site. Those steps need the owning installation's reviewed Cloudflare workflow. No historical records are fabricated. Existing installations pinned to the earlier local `@vitris/admin` tarballs are unaffected; upgrades require a reviewed dependency, migration and copied-asset diff.

## Website agent integration

The generated `AGENTS.md` points agents to [the backend workflow](packages/admin/agent/WORKFLOW.md). The workflow covers schema, permissions, module code, migrations, verification and release evidence. This gives a website agent instructions for changing the backend without introducing an always-running agent inside the service.

From an installation, use:

```sh
vitris-admin module --slug estimates --name "Estimates"
vitris-admin connect --site ../acme --plan
vitris-admin connect --site ../acme --apply
```

The module scaffold is read-only and not enabled automatically. Register its trusted handler in both Worker entry points and enable its ID in the intended manifests. The admin's own connection command records metadata only. The updated harness also exposes `vitris admin setup|status|verify` to scaffold installations, prepare hashed backend grants, and verify data access. Existing contact forms remain on their current backend. Cloud allocation and deployment are explicit rollout steps.

For an existing harness backend, configure `backend: {provider: "vitris-harness", origin: "https://BACKEND", tenantId: "TENANT_ID"}` in the production installation manifest. Set `HARNESS_API_TOKEN` as a Worker secret. Merge its matching hashed grant into the backend's `ADMIN_CONNECTIONS` secret map. Default scopes are `leads:read` and `analytics:read`; `leads:write` is optional. The dashboard shows backend failures instead of substituting synthetic data. Local demo access is disabled whenever a remote backend is configured.

## Verification

```sh
npm run check
```

Checks include TypeScript, production builds, manifest/role tests, workerd/D1 integration tests for canonical hosts, CSRF, record scoping, revocation, concurrent login token reuse, expired links, settings conflicts, and package installation outside the workspace. Synthetic data and stubbed email are used throughout. No production credentials are required.

MIT licensed. Each installation's customer data and infrastructure credentials remain private.

Calendar synchronization source and local preview: see [setup and operations](packages/admin/agent/refs/calendar-sync.md). Google/Outlook apps are business-owned; calendar attachments and opt-in customer email/management links are implemented; real sender/inbox acceptance remains separate.

Standard website guest bookings are opt-in; read [setup and verification](packages/admin/agent/refs/public-booking.md) before enabling them.

Customer email and private cancellation/rescheduling link setup: [reference](packages/admin/agent/refs/customer-notifications.md).
