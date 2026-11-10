# Website Admin Harness

A standalone, open-source business website admin built around Cloudflare. Each business gets its own installation at `admin.business.com`, its own accounts and records, and explicit agent-maintained modules. Version 1.0 provides reusable infrastructure; production installations require explicitly configured infrastructure and authentication.

## Working directory

The standalone source lives in its own Git repository and npm workspace, separate from the website harness and customer-specific installations. Clone it as `website-admin-harness`. The npm packages are `@tryvitris/website-admin-harness`, `@tryvitris/create-website-admin-harness`, and `@tryvitris/website-admin-contracts`.

Repository: [jackperrotta/website-admin-harness](https://github.com/jackperrotta/website-admin-harness).

## Local preview

For the optional Vitris client-management variant, use `npm run vitris:preview`. See [the prototype walkthrough](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/VITRIS-PROTOTYPE.md) for client analytics and the simulated website update/publishing flow. Other installations do not enable this module.

For the optional billing prototype, use `npm run billing:preview`. Review the business dashboard at http://127.0.0.1:4394/#billing and the separate client admin at http://localhost:4395/#account-billing. See [the billing walkthrough](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/BILLING-PROTOTYPE.md). All payments, invoices, and subscription actions are simulated; no Stripe account is connected.

The separate [Stripe integration](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/STRIPE-BILLING.md) is opt-in installation infrastructure, exported through `/billing`. Each business configures its own account, prices, currency, portal policy and client grants. Read [the agent setup workflow](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/billing.md); no Stripe module, customer, migration or financial action is enabled by default.

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

## Available in version 1.0

- Branded responsive shell with Overview, Leads, Analytics, Settings, Users and access, and Activity.
- Lead search, status/due/assignee filters, follow-up notes and keyset pagination; analytics date ranges and history; saved notification preferences with revision conflict checks. Local previews use synthetic data, while configured backend connections read authoritative records.
- Work queue module with persistent task creation and completion.
- Opt-in [scheduling module](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/SCHEDULING.md): day/week/agenda calendar, service and staff management, scoped availability, test appointments and atomic resource reservations. Google/Outlook calendar sync and calendar files are implemented in source; test-mode website bookings now use the same admin calendar.
- Trusted build-time module handlers, explicit manifest enablement, permission checks, and generic record-list UI.
- Canonical-host checks, CSRF Origin checks, D1 sessions, revocable account access, and opt-in owner setup, team invitations, verification and password recovery through Cloudflare Email Service.
- npm runtime, initializer and validated contracts packages; generated installation projects; designated-owner setup; module scaffold and agent kit.
- A connection planner that records public admin metadata in an existing website's launch.json while preserving its forms and backend origin.
- Optional Stripe seller and client billing modules: approved subscription/one-off Checkout, invoice drafting and delivery, payment history, customer-bound invoice access and self-service through Stripe's customer portal. Each installation owns its Stripe account configuration and secrets; live writes require explicit activation. See [billing](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/STRIPE-BILLING.md) and [rollout](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/docs/STRIPE-LIVE-ROLLOUT.md).
- Client-management and onboarding previews with reusable templates, editable questions, invitation flow and desktop/mobile layouts. These explicitly synthetic prototypes support agent-led adaptation; they do not provision or publish client websites.
- Installation-scoped owner enrollment, team invitations, verification and password recovery, plus an explicit Pages adapter/private-mail bridge for existing installations that use it.
- Publication privacy checks for Git candidates and actual npm archives, including staged credentials and private environment files.

Pages and Media editing, arbitrary HTML editing and a page builder are outside scope. A future AI workflow will handle content and media. A configured harness connection reads authoritative production leads and analytics without copying records or replacing the form pipeline. Websites without collection must enable it separately. Saving notification preferences does not change live delivery. Ownership transfer, full exports/restores, and automatic cloud provisioning remain follow-up milestones. Authentication mail uses provider stubs in automated tests; each installation requires sender onboarding and delivery verification. See [account setup and recovery](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/accounts.md) for installation prerequisites and the existing-owner upgrade path. Scheduling retains explicit test-only booking safeguards; a stable package version does not activate live booking or live Stripe collection.

## Packages and installation

The stable release is `1.0.0`, distributed under the `latest` tag. Requires Node.js 24 or newer.

- `@tryvitris/website-admin-harness`: compiled Worker runtime, UI, migrations, CLI and agent kit.
- `@tryvitris/create-website-admin-harness`: installation initializer using the runtime CLI.
- `@tryvitris/website-admin-contracts`: installation manifest validation and module/permission contracts.

Create a separate installation with `npm create @tryvitris/website-admin-harness@latest -- --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://acme.com`.

For the current local build:

```sh
npm run build
node packages/admin/bin/admin.mjs init --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://acme.com
```

All maintained code uses strict TypeScript, including the CLI, scripts, tests, and generated installation sources. Node.js 24 or later runs repository scripts; npm packages ship compiled JavaScript entry points with declarations. The generated installation includes `worker.ts`, `worker.local.ts`, typed module scaffolds, and `npm run typecheck` / `npm run check`.

The generated installation pins the exact runtime version. Run `npm install` in the generated directory. It contains separate production and local Wrangler configurations and a copied UI release. Future package updates must also update copied UI/migrations/agent material through a reviewed diff; automatic upgrade tooling is not available yet.

Use `vitris-admin plan` to inspect setup prerequisites. It makes no cloud writes. D1/R2 creation, actual resource ownership, DNS/TLS, sender onboarding and production deployment need real account configuration. See [Cloudflare deployment](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/cloudflare.md).

## Website harness setup

A website agent can use the published package without a local checkout of this repository:

```sh
npx --yes @tryvitris/website-admin-harness@latest setup --site ../acme --dir ../acme-admin --domain admin.acme.com --website https://www.acme.com --tenant EXISTING_TENANT_ID --backend-origin https://BACKEND --plan
```

Review the website's `artifacts/admin/setup-plan.json`. Set a new dedicated `VITRIS_ADMIN_API_TOKEN` in the operator environment, then repeat with `--apply`. Install the generated admin's dependencies. Repeating the same applied setup is a no-op; changed plans, unrelated existing directories, and conflicting connections are rejected.

Setup preserves existing website forms, backend URL, pages and workflow state. It saves only the token hash in the installation's ignored `.vitris/backend-grant.json`. Merge that grant into the backend's complete `ADMIN_CONNECTIONS` map and upload the raw credential to this admin as `HARNESS_API_TOKEN` through secret stdin. Default scopes are `leads:read` and `analytics:read`; use `--lead-write` during both planning and applying only when status changes are intended.

The backend must already implement the Vitris admin v1 API. Setup does not add that API to an older website-harness deployment, create Cloudflare resources, enable form/analytics collection, migrate production data, configure authentication mail, or deploy either site. Those steps need the owning installation's reviewed Cloudflare workflow. No historical records are fabricated. Existing installations pinned to the earlier local `@vitris/admin` tarballs are unaffected; upgrades require a reviewed dependency, migration and copied-asset diff.

## Website agent integration

The generated `AGENTS.md` points agents to [the backend workflow](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/WORKFLOW.md). The workflow covers schema, permissions, module code, migrations, verification and release evidence. This gives a website agent instructions for changing the backend without introducing an always-running agent inside the service.

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

Calendar synchronization source and local preview: see [setup and operations](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/calendar-sync.md). Google/Outlook apps are business-owned; calendar attachments and opt-in customer email/management links are implemented; real sender/inbox acceptance remains separate.

Standard website guest bookings are opt-in; read [setup and verification](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/public-booking.md) before enabling them.

Customer email and private cancellation/rescheduling link setup: [reference](https://github.com/jackperrotta/website-admin-harness/blob/v1.0.0/packages/admin/agent/refs/customer-notifications.md).


### Optional Cloudflare customer email

Version 1.6.0 adds the opt-in `email-campaigns` module: contacts and CSV imports, preferences and suppressions, audience segments, structured versioned templates, captured campaigns, schedules, guided website workflows, recurring customer reports, and native Cloudflare sending/feedback. Each business retains its own account and resources. Newsletter composition and recurring drafts are available; general newsletter/promotional transmission is not enabled under Cloudflare's current transactional-only scope. No additional email provider is included.

Prepare an existing installation with `vitris-admin email-setup --dir EXISTING_ADMIN --from EMAIL_CONFIG.json --plan`, review the diff, then use `--apply`. Package updates do not enable, migrate, deploy, or send automatically. Read the packaged [setup, acceptance and recovery guide](docs/EMAIL-CAMPAIGNS.md) and [agent reference](agent/refs/email-campaigns.md).

## Google Search Console

Enable the optional `search-console` connection to connect Google in Settings and read search performance, sitemap status and indexed URL inspection in Analytics. The owner can import Google OAuth client JSON and complete account authorization inside authenticated Settings. Google requires a one-time app registration, guided in the panel; saved client secrets are encrypted and never returned. A dedicated `/search-console` cron companion supports existing Pages installations. Setup, website verification, permissions, API pagination, scheduled snapshots and agent guidance are documented in [the Search Console reference](agent/refs/search-console.md). Existing installations require an explicit migration, configuration and Google authorization; this package does not connect or deploy them automatically.
