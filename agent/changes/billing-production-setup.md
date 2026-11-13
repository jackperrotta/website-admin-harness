# Owner-managed billing launch

Add an optional reusable managed Stripe module over the existing billing service. Preserve the legacy encrypted per-installation/test/live settings envelope, customer scopes, grants and existing financial gates. No business defaults or credentials belong in the package.

Expose owner-only connection, approved catalog, portal policy, readiness and explicit activation/deactivation routes. Catalog/portal preparation may create reviewed configuration objects, never customers, invoices, subscriptions or payments. Financial actions require both deployment authorization and the saved owner activation. Saving connection or policy changes clears activation. A paused integration does not stop Stripe renewals or invalidate issued payment links.

Add optional settings and health migrations, retain existing applied schema. Check provider account/mode, exact versioned webhook, approved fixed prices, applied portal policy, scheduler health, event failures, and recorded owner sandbox/email/retry/tax reviews before activation. Account-wide Stripe email and retry settings are explicitly external; do not pretend local acknowledgments configure Stripe.

Verify legacy settings, concurrency, authorization, disabled modules, isolation, no-write setup, activation/deactivation, stale policy rejection, signed hooks, scheduler recovery, desktop/mobile UI and externally packed consumption. Preserve installation credentials and independent free sites. Do not enable live charges, publish npm or alter other installations as a test side effect.

## Completed 2026-11-13

Implemented the optional managed module, encrypted settings compatibility, owner setup UI, catalog and portal preparation, existing webhook preparation, readiness and separate activation controls. Prepared package-scoped 1.9.0 release notes and three verified archives. Publication is separately authorized after acceptance; no installation configuration or deployment receipts belong in the release.

Final `npm run check` passed privacy, build, typecheck and all 278 tests, including external packed-package installation and managed billing activation/deactivation. The adopting installation passed its 45 checks and desktop/mobile browser acceptance. Real Stripe sandbox monthly/yearly/one-off catalog and portal configuration tests passed without creating customers, invoices, subscriptions or payments. Financial regression tests cover renewal failure/recovery, duplicate events, invoice sending and client isolation.

Adoption preserves encrypted settings, account scopes and existing records. Owners must configure plans, portal policies, webhook delivery and account-wide policy reviews before activation. Installation-specific deployment details and private evidence remain outside source and release archives.
