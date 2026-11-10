# Google Search Console integration

Implement an optional built-in `search-console` connection. Keep setup in Settings and reports in Analytics; no new navigation. The admin owns OAuth, encrypted credentials, scoped property selection, durable report snapshots and scheduled refresh. The website owns public verification tokens, canonical URLs, robots and sitemaps. No existing installation, backend, forms, DNS or deployed website is changed by this work.

Read access requires `analytics:read`; connecting, changing properties, disconnecting and submitting a sitemap require the new `search-console:manage` capability. Use separate Google OAuth credentials and encryption keys from calendars. Bind state and encrypted credentials to installation/site/admin origin, consume state atomically, and fence in-flight work on configuration revision. Support Google's official performance dimensions/types/filters/pagination, sitemap reports and URL inspection. Preserve Pacific report dates, API limits, privacy filtering, unavailable reports and freshness. Do not infer clicks equal website visits or attribute enquiries to individual search terms.

Add migration 0012, local provider fixtures, disabled/unauthorized/cross-site/replay/revocation tests, packed-package consumer verification, and agent setup/API documentation. Publication, customer deployment, remote migration and Google account authorization are separate installation steps.

## Verification

- Full `npm run check`: 264 passed, zero failed, including privacy, build, type checks and external packed installation.
- Final build and targeted Search Console/browser checks after OAuth revocation hardening: 10 passed. Desktop 1440 px and mobile 390 px screenshots reviewed.
- Candidate 1.7.0 archives prepared with package-specific documentation and notes; `npm run release:verify-packed` passed against the final archives outside the workspace. Nothing published or deployed.
- Website harness `src/render.test.ts` and `src/search-console.test.ts`: 12 passed. A broader `src/performance-media.test.ts` run could not load an existing missing `D:/VitrisArtifacts/vitris-v3/legacy-templates-20261009/compat/src/agent/theme-assets.ts`; that unrelated legacy dependency was left intact.
- Google HTTP behavior is exercised with isolated synthetic fixtures. Real OAuth consent, Google Cloud app configuration and live property/site verification remain installation setup steps.

## Owner setup and authorized Vitris rollout

The owner requested publication, GitHub push and live testing in the Vitris admin. Add owner-only application setup and Web client JSON import in Settings, keep secrets encrypted/write-only, invalidate old credentials/pending authorization on changes, and publish the scoped 1.7.0 release family. Preserve environment configuration as a compatibility fallback. Supply an optional Search Console-only cron companion for existing Pages hosting. Test ownership, redaction, stale revisions and authorization invalidation before publishing. Update only the Vitris installation; retain its private baseline/database backup and exact Pages/D1/R2/mail/billing identity. Live Google account consent remains an owner action in the deployed panel.

Owner-setup release validation: the full release check passed 267 tests with zero failures; the final UI save-state repair was rebuilt and the final archives passed external packed-install verification. Vitris remote state was read without changing records; its dedicated database export, preservation hashes, previous Pages deployment and scoped additive migration/deployment plan are retained privately. npm publication requires renewed owner registry authentication after the saved login returned HTTP 401.
