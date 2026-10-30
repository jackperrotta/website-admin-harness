# Scheduling contracts and foundation

Add an opt-in authenticated scheduling module and versioned shared contracts. Keep the existing users and roles intact; owners and administrators have scheduling authority and other active users require explicit site-scoped grants. Provider grants are resolved from trusted resource assignments, never browser declarations.

Store bounded operational configuration as one validated, revisioned aggregate per site. Store appointments, exclusive resource claims, command receipts, history, and captured jobs in relational tables. New migration 0004 leaves existing migrations and records intact. A transactional revision guard prevents calculations made from stale configuration from committing. Database triggers maintain all appointment resource claims and reject overlaps, including reschedule races.

This slice includes test-mode configuration, timezone-aware weekly availability and exceptions, manual appointments, approval, status changes, atomic rescheduling, idempotent commands, and own-versus-all access. No new Cloudflare bindings. Public booking, production activation, actual notification delivery, OAuth, calendar synchronization, and a dedicated calendar UI remain subsequent slices. Captured jobs are synthetic test outputs, not successful deliveries.

Verify parsers, DST behavior, migration preservation, workerd/D1 concurrency and rollback, cross-site and provider isolation, revoked grants, disabled modules, CSRF, package exports and installation outside the workspace. Run npm run check. Do not publish, deploy, apply remote migrations, or change customer installations.

Implemented and locally verified October 28, 2026. `npm run check` passes the build, strict typecheck, and all 36 tests, including external packed-package installation. Original migrations 0001 through 0003 remain unchanged. Verification output is in ignored `artifacts/scheduling/check.log`; source hashes and a verification receipt are recorded alongside it. The source remains opt-in and test-only, with explicit unavailable calendar-sync/public-booking status. No cloud or registry writes were performed.
