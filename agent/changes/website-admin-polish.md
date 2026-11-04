# Local website and admin polish

Keep the current account, scheduling, onboarding and billing work intact. No npm publication, provisioning, remote migration, deployment or customer mail is included.

Booking uses the website's shared typography roles, with readable fallbacks for older sites. Admin core, analytics, account and scheduling screens use a common readable type scale. The website admin status response exposes only validated public color tokens from that tenant's stored theme; existing manifest/default fallbacks remain supported.

Lead follow-up adds assigned active teammates, private notes, a UTC follow-up date and completion, with optimistic revisions. Connected installations keep these fields in the website backend, scoped to tenant AND installation. Local standalone installations keep them in their own D1. Existing leads:read/leads:write permissions and the dedicated backend grant apply; test submissions are always read-only. Server-side search, status/due/assignee filters, keyset pagination and full new-lead totals avoid the latest-200 limitation. Older backends remain readable and explicitly report their limited capability.

Additive migrations: website 0006_admin_lead_followups.sql; admin 0010_lead_followups.sql. Neither rewrites existing leads/accounts. Installations need a separately reviewed backup, package/UI diff and migration before rollout. No new cloud bindings or notification authority.

Validate scoped API reads/writes, stale revisions, missing migrations, assignment/revocation, cross-tenant/installation IDs, read-only grants and test separation. Verify paired website colors/booking typography and admin lead workflows at desktop/mobile sizes; run both repositories' checks and external packed-package acceptance.
