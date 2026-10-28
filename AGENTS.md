# Website Admin Harness agent instructions

This is a standalone Cloudflare business admin application and npm workspace. Read `packages/admin/agent/WORKFLOW.md` before changing backend modules or connections.

Default stack: Cloudflare Workers for API and UI assets, D1 for durable relational records and atomic login-token consumption, R2 for business assets and exports, and Cloudflare Email Service for authentication mail. Alternative adapters must be explicit; never silently add another paid service.

Core navigation is Overview, Leads, Analytics, Settings, Users and access, and Activity. Do not add Pages, Media, a drag-and-drop builder, or arbitrary HTML editing. Content editing will follow a separate AI workflow.

Run `npm run check`. Keep public packages free of customer data and credentials. Test from packed packages outside the workspace. Local demo access requires both an explicit local mode and an exact loopback admin origin. Do not introduce a production development-login fallback.

Each business has a separate installation and its own hostname. Preserve its users, records, exact origins, and existing harness form configuration. Module changes need scoped permissions, additive migrations, and tests of disabled/unauthorized access. Never deploy or migrate a shared existing backend as a side effect of module work.
