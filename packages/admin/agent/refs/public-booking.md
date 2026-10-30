# Public website booking

This source release adds an opt-in guest booking API alongside the authenticated admin API. A website can list published services, request available times, and submit a guest appointment without an admin session. The shared engine calculates availability and native D1 triggers reserve the same staff, rooms and equipment used by admin appointments. Calendar connections receive the same durable export jobs.

## Explicit enablement

Review the compatible runtime/contracts packages and additive migration `0006_public_booking.sql` after 0005. Earlier migrations remain unchanged. New scheduling installations still default to disabled. In Scheduling → Booking settings, select Test mode, publish specific services, provide the customer booking policy, and explicitly allow website booking. Services requiring a customer-site address are excluded until structured address/intake support is implemented. Existing external booking links must be retained until an explicitly reviewed replacement is ready.

Set `BOOKING_ENABLED=1` in the installation's server environment. The only accepted public browser Origin is the exact `manifest.site.origin`; public requests still target the exact canonical admin origin. Configure the following server settings before any non-loopback testing:

- `BOOKING_TURNSTILE_SITE_KEY`: the public key for a Turnstile widget allowing the exact website hostname.
- `BOOKING_TURNSTILE_SECRET`: the widget's secret, stored through the established protected Worker-secret workflow.
- `BOOKING_RATE_SECRET`: at least 32 random characters, stored as a server secret; used to hash rate-limit identities. Do not put raw IPs in application records or logs.

The component renders Turnstile with action `booking`. The server verifies success, website hostname and action. Test keys and missing secrets cannot enable a non-loopback booking endpoint. Siteverify failures fail closed; no booking is accepted solely because the client displayed a challenge. See [Cloudflare server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

This release retains **test-only appointment mode**. Opt-in customer emails, calendar attachments and private cancellation/rescheduling links are implemented; read `customer-notifications.md` and review migration 0007. Local mode captures emails, while send mode requires a verified sender and an explicit test-recipient allowlist. It does not enable a production launch. An enabled real calendar connection receives test appointment writes; designated test calendars and separate real-account acceptance remain required. Production delivery acceptance, deposits, structured intake and live booking mode remain separate work.

## Public contract

Import the DTOs and strict parsers from `@tryvitris/website-admin-contracts/scheduling` in a compatible source/release. The current published alpha does not contain this work.

| Route | Behavior |
| --- | --- |
| GET `/api/booking/v1/catalog` | Public site/installation identity, test mode, published service terms, locations, staff names, confirmation rules, customer policy and challenge requirements |
| GET `/api/booking/v1/availability` | Strict `serviceId`, `locationId`, optional `providerId`, UTC `startsAt` and `endsAt`; at most seven days. Returns available slots, current revision and current customer-facing terms/policy |
| POST `/api/booking/v1/appointments` | Guest details, selection, current revision, UUID `idempotencyKey`, `acceptedPolicy:true`, `challengeToken` and an empty `company` honeypot |
| OPTIONS on those routes | CORS only for the approved website Origin, without credentialed cookies |

Guest requests cannot list appointments, specify status/price/site identity, access staff accounts, read grants, or use admin mutation routes. Browser requests use `credentials:omit`; no admin cookie or secret belongs on the website. Catalog and availability expose no customer identities, external event contents, room names, private availability rules or account links. Responses are uncached and site-bound. Changes to price or policy are returned before review and invalidate an older booking selection.

Each command is protected by a separate guest ledger and transactional revision/publication guard. It does not impersonate a staff account. Native reservations, captured jobs, guest history and the command receipt commit atomically. Guest history appears in admin appointment details. The same UUID and content replay the stored original receipt; changed content conflicts. Receipts describe the original accepted request, rather than serving as current appointment-management authority. The browser retains the attempt in memory, preserves customer details on a stale selection, and offers Retry same booking after an uncertain response. Closing the page discards that in-memory retry authority; retain the displayed reference and contact the business before attempting another booking.

Limits are per hashed incoming Cloudflare IP: 60 catalog requests/minute, 30 availability queries/minute, 30 submission requests/minute and five new attempts/hour. Invalid new attempts consume the hourly budget. Identical committed retries do not consume another new-attempt allowance. Shared networks can share the allowance. Expired rate records are deleted through subsequent requests. Review these limits before a production release; additional edge/WAF protection and telemetry belong to deployment review.

Calendar outages, unknown busy state and pending exports pause affected availability. Required calendars refresh again before a guest commit. External-provider failures after commitment retain the native appointment and its durable job; a queued export is not proof of synchronization. Instant bookings return confirmed; approval services return a pending request and its hold deadline. Actual email delivery is never promised in this test interface. Receipts contain an `.ics` snapshot download, which is not an ongoing calendar subscription.

## Local paired preview and verification

Use the reviewed local CLI to prepare an existing website connection without requiring a leads/analytics backend:

```sh
node packages/admin/bin/admin.mjs scheduling-connect --site ../synthetic-website --dir ../synthetic-admin --local --plan
node packages/admin/bin/admin.mjs scheduling-connect --site ../synthetic-website --dir ../synthetic-admin --local --apply
```

`--local` reads `admin.local.json` and requires both exact origins to be loopback; the website's `publicOrigin` must match. An optional `--route /appointments` chooses a safe route. Run from the admin harness source or use the equivalent `vitris-admin` command from reviewed packed packages. The command stores a digest-bound plan and launch backup in the website's ignored artifacts, preserves unrelated fields, and writes only `launch.json.scheduling`. It does not enable the module, change either manifest, apply a migration, configure secrets, or deploy. Existing conflicting connections require explicit migration. Scheduling-only installations need no website backend token.

Booking settings shows public connection metadata and separate checks for schema, module, server flag, challenge settings, publication and calendar health. These are configuration checks, not proof of live challenge/provider acceptance. Scheduling and Overview refresh every 30 seconds while visible, refresh on focus/reconnect, and back off after failures. Background reads retain editor drafts and their original revisions. Overview counts the next 31 days on the server with the same own/all provider scope as appointments. Website source and accepted policy come from retained guest receipts; later policy edits do not replace the accepted text.

`npm run check` requires the sibling website source for paired acceptance and also packs and installs the website/admin/contracts/initializer outside both workspaces for a separate browser flow. Neither suite silently skips the booking integration. Production mode, notification delivery and published-package pins remain outside this local test change.

In a maintainer workspace with sibling `website-admin-harness` and `vitris-harness`, run `npm run booking:preview` from the admin source. It starts the compiled website at **http://localhost:4392/book** and the admin at **http://localhost:4391/#scheduling**. Choose Open local demo for the admin. Both share an isolated, ephemeral D1 database and explicitly simulated Google/Outlook providers. Data resets when the preview stops. Stop an existing preview on those ports before starting the paired one.

The loopback challenge fixture requires every condition: `MODE=local`, `BOOKING_LOCAL_TEST=1`, and both exact website/admin origins on loopback. This bypass cannot activate for an HTTPS customer website. The separate `BOOKING_CHALLENGE_HTTP` binding is a trusted test transport, never browser configuration or a production fixture.

`npm run check` includes real local D1/public-contract tests, shared native-reservation regressions, calendar adapter tests and packed-package acceptance. Paired browser tests require the sibling website source and fail with an actionable message when it is missing. A separate test builds and installs packed website/admin packages outside the workspace. Browser cases exercise the actual compiled component against workerd/D1, including admin visibility, calendar export, approval, duplicate prevention, lost responses, current pricing, empty states, keyboard/mobile behavior and an axe accessibility check. Outputs stay in ignored artifacts. Provider HTTP and Siteverify are isolated fixtures; these tests do not prove real challenge execution, real OAuth acceptance, email delivery or a deployed service.

Never provision, remotely migrate, publish or deploy as an enablement side effect. An actual release needs compatible package pins, reviewed origins, schema backup/recovery, secrets, real Turnstile and provider acceptance, public policies, notification onboarding and separate deployment authorization. Pause website booking through settings as the first recovery control; preserve existing appointments and sync jobs.
