# Website Admin Harness agent instructions

This is a standalone Cloudflare business admin application and npm workspace. Read `packages/admin/agent/WORKFLOW.md` before changing backend modules or connections.

Default stack: Cloudflare Workers for API and UI assets, D1 for durable relational records and atomic login-token consumption, R2 for business assets and exports, and Cloudflare Email Service for authentication mail. Alternative adapters must be explicit; never silently add another paid service.

Core navigation is Overview, Leads, Analytics, Settings, Users and access, and Activity. Do not add Pages, Media, a drag-and-drop builder, or arbitrary HTML editing. Content editing will follow a separate AI workflow.

Run `npm run check`. Keep public packages free of customer data and credentials. Test from packed packages outside the workspace. Local demo access requires both an explicit local mode and an exact loopback admin origin. Do not introduce a production development-login fallback.

Before release packing, author `docs/releases/<version>.json` with matching version and separate runtime, contracts and initializer titles, `notesScope: "package"` and substantive shipped-change bullets. A version/dependency-only package update should say so. `release:pack` embeds the exact package-specific README and notes as `vitris-release.json`; `release:publish` verifies all three archives and registry receipts before notifying public documentation. After npm succeeds, retry documentation alone with `npm run release:docs`; never republish an existing version. Private `.vitris/release-docs.json` or webhook environment credentials must stay outside source and archives. A hosted five-minute reconciler catches missed hooks. Documentation automation does not authorize npm publication or customer deployment.

Each business has a separate installation and its own hostname. Preserve its users, records, exact origins, and existing harness form configuration. Module changes need scoped permissions, additive migrations, and tests of disabled/unauthorized access. Never deploy or migrate a shared existing backend as a side effect of module work.
