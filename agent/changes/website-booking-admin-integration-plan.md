# Website booking and admin integration plan

October 30, 2026

Website appointments should appear in the business's existing Scheduling workspace as soon as they are saved. The admin should also make new requests visible while it is open, explain whether the website connection is ready, and provide a clear route from Overview to the appointment needing attention.

The current source already implements the central connection. Extend and release it rather than creating another appointment store or importing bookings through Leads. Production customer booking needs a separate completion phase because the current contracts, database guards and website component accept test mode only.

## Current implementation

The relevant website checkout is `E:/Projects/vitris-harness`, the source for `@tryvitris/website-harness`. The older `E:/Projects/vitris-v3` checkout does not contain this standard booking implementation.

| Area | Existing source behavior | Remaining integration work |
| --- | --- | --- |
| Website component | `src/scheduling/` implements service, location/staff, time, customer details, policy review and a confirmed or pending receipt. `src/build/index.ts` mounts it on the configured route. | Retain the standard component and verify it against released packages. |
| Website connection | Public `launch.json.scheduling` supplies the exact admin API origin, site ID, installation ID and route. The widget checks the returned identity. | Add an installation workflow that prepares and verifies this metadata. Existing admin setup writes `launch.json.admin`, not scheduling metadata. |
| Public booking API | Admin `src/scheduling/public.ts` serves catalog, availability and appointment creation under `/api/booking/v1`. | Add useful readiness diagnostics and complete operational rollout. |
| Appointment storage | Website and admin commands use the same D1 appointments, resource reservations, revisions and calendar export jobs. Guest commands have separate authorization and history. | Preserve this transaction boundary. No replication service or additional paid backend is needed. |
| Admin operations | Scheduling already has day/week/agenda views, services, staff/resources, availability, publication settings, approval, cancellation, staff rescheduling and calendar connections. | Add automatic refresh, prominent incoming requests and website source details. |
| Acceptance | `tests/website-booking-ui.test.ts` books through the compiled sibling website and opens the result in admin; API tests cover native reservations and conflicts. | Require this suite in integration acceptance and repeat it from packed website and admin packages. The current paired suite imports website source and can skip when that checkout is absent. |
| Release and production | Website setup still pins admin `0.1.0-alpha.1`; the repository references describe booking as unreleased. Scheduling mode and notification delivery are test/captured only. | Coordinate exact compatible package versions; complete live mode and actual delivery before customer launch. |

Admin scheduling is independent of `manifest.backend`, which currently connects website Leads and Analytics. Booking requests go directly to the admin origin. Keep the existing backend credential and scopes unchanged.

## Phase 1 Make connection setup explicit

Extend the admin CLI with a dedicated scheduling connection plan and apply operation for an existing installation. Keep it separate from the current setup command's required Leads and Analytics backend. Scheduling should be usable even when the website has no collecting form or analytics backend.

The plan must compare the installation manifest with the website's existing `launch.json`, report exact origins and identities, identify compatible package versions and required schema, and propose only the scheduling metadata. Preserve forms, backend URL, existing admin connection, authored booking pages and external booking links. Conflicting connections require an explicit migration plan. Apply changes only against the reviewed input digest, with backup and safe retries.

Add a scheduling connection view under Booking settings. Show the approved website origin, public connection metadata to copy, published services, current mode, and separate readiness for the module, schema, server booking flag, challenge configuration and calendar health. The current `publicBooking` boolean checks server/settings flags; it is not proof that the full guest endpoint is ready. Never return secrets or private provider details to the website.

Primary files: `packages/admin/bin/{admin,setup,types}.ts`, `packages/contracts/src/scheduling.ts`, `packages/admin/src/scheduling/{module,public}.ts`, and `packages/admin/ui/src/scheduling/{workspace,configuration}.tsx`. Follow through in the website CLI, pinned dependencies, admin integration tests and scheduling documentation.

Acceptance: a reviewed local plan connects the correct website and installation without cloud writes; mismatched origins/identities and stale plans fail; unrelated launch fields and existing users/records remain intact. Connection readiness reports actionable failures without presenting fixtures as a deployed service.

## Phase 2 Keep an open panel current

The calendar currently loads on entry, changes of view/date and explicit Refresh schedule. Add bounded polling while the scheduling view is visible, plus refresh on window focus and return online. Start with a 30-second interval, avoid overlapping requests, cancel stale responses and back off after errors. No new realtime service is required.

Refresh the visible appointment range and status without discarding an open editor or replacing its revision. A pending draft must retain its fields and receive the existing conflict handling if another action changes the schedule. Show the last successful refresh and a clear stale/error state.

Add an additive, site-scoped summary endpoint under `/api/modules/scheduling/summary` for upcoming appointments and requests needing approval. Calculate counts server-side rather than counting the first 200 calendar results. Apply the existing scheduling permissions and own/all provider scope. Keep Scheduling as the optional business tool and retain all core navigation sections.

Use that response for an Overview card with upcoming appointments, pending approval and a link to Scheduling. Show test labeling while the installation is in test mode. Do not put appointments into lead totals or label test appointments as production conversions. Update the Overview module callout, which currently describes installed tools as Work queue.

Primary files: `packages/admin/src/scheduling/{module,store}.ts`, shared scheduling contracts, `packages/admin/ui/src/scheduling/workspace.tsx`, and `packages/admin/ui/src/main.tsx`.

Acceptance: leave admin open, submit a website booking in another browser context, and see it within one polling interval without navigating or manually refreshing. Provider accounts see only their assigned appointments and counts. Hidden views stop polling; open drafts survive refresh and reconnect.

## Phase 3 Show website origin and accepted terms

Expose a server-derived source such as website or staff on appointment DTOs and details, using the guest command/history records already stored. Preserve existing guest history. Show the customer's reference and the policy accepted at booking time; the public command receipt already retains policy text, while the appointment snapshot currently contains service/location terms rather than that customer policy.

Use an additive metadata migration only if the existing records cannot support an efficient, durable query. Backfill provenance from trusted command/history evidence and retain unknown for historical records that cannot be classified. Never infer source from customer-entered fields or overwrite historical terms with today's policy.

Keep appointment history authoritative. If website events also appear in core Activity, expose only a minimal event and permission-checked link; require scheduling authority before revealing appointment details, including for provider-scoped accounts. Existing `activity:read` alone must not disclose customer scheduling data.

Acceptance: a website booking is identifiable in the calendar/details, retains its original policy after settings change, and cannot be read through Activity or Overview by an unauthorized account. Staff-created bookings retain their existing history and behavior.

## Phase 4 Complete production booking

Treat live operation as a distinct release after the test integration works. It requires coordinated changes to shared mode contracts, the database's test-only checks and triggers, server command guards, DTOs, website catalog validation and both interfaces. Preserve migrations 0001 through 0006; add the next reviewed migration. Retain historical test records as test records and define separate live/test queries, reservations, jobs and counts so a mode change cannot turn synthetic bookings into customer bookings.

Implement a durable notification delivery worker using the agreed Cloudflare email stack and a verified business sender. Record queued, delivered and failed states, retries and deduplication for booking, approval, changes and cancellation. Keep the saved appointment authoritative when mail or calendar providers fail. Review appointment content, customer contact details and calendar attachments separately from authentication email.

Before enabling a business, verify real Turnstile execution, business-owned Google/Outlook authorization, encrypted token storage, scheduled polling and canonical domains using designated test accounts. Keep actual delivery and calendar status visible. Customer self-service cancellation/rescheduling, deposits, accounts and structured address/intake can remain later features; an initial live release must give customers a reviewed way to contact the business for changes.

## Verification and release

1. Run `npm run check` for the admin. Retain coverage for disabled modules, unauthorized users, provider scope, revoked grants, cross-site IDs, exact origins, malformed input, stale revisions and transactional races.
2. Run paired browser acceptance with both repositories present. Cover instant and approval bookings, admin visibility, automatic refresh, original policy, last-slot races, uncertain response retry, cancellation/reschedule, external busy time and export failure. Exercise desktop, mobile, keyboard use and accessibility.
3. Run website typecheck, tests and package verification. Install exact packed website, contracts, admin runtime and initializer packages in a temporary directory outside either workspace, then repeat the end-to-end flow without sibling source imports. Integration acceptance must fail if its required paired test is skipped.
4. Prepare a coordinated release diff and exact compatibility pins, including `vitris-harness/src/cli/admin.ts`, its dependency pins and documentation. Update installation instructions without automatically replacing installation-specific entry points or manifests.
5. For each business rollout, separately review its resources, backups, additive migrations, secrets, owner onboarding, origins and package revisions. Preserve users, records and forms. Provisioning, remote migration, publication and deployment require their own authorized operation; a connection command must not perform them.

The immediate implementation scope is Phases 1 through 3 in test mode, followed by packed-package acceptance. Phase 4 is required before the website can take real customer appointments.

## Current baseline verification

On October 30, 2026, `npm run check` passed the admin build, strict typecheck and all 87 tests with no skips. This includes external packed admin-package installation and all five paired website/admin browser cases. The paired cases use compiled website source, real local D1 and simulated provider/challenge transports; the proposed packed website integration, automatic refresh and live delivery checks remain implementation work.

## Implemented local integration

Phases 1 through 3 are implemented in test mode. The new `scheduling-connect` CLI prepares public metadata for an existing installation independently of Leads and Analytics setup. It binds the reviewed plan to the website, manifest, CLI digest and package version, supports safe retries and preserves a launch backup. Explicit `--local` uses `admin.local.json` and requires exact loopback origins. The command does not enable modules or change installation manifests.

New authenticated GET routes are `/api/modules/scheduling/summary` and `/api/modules/scheduling/booking-readiness`. Summary uses existing `appointments:read` authority and own/all provider scope. Readiness additionally requires `scheduling:configure`. No permissions, Cloudflare bindings or migrations are added. Existing guest command receipts and appointment history provide source and accepted policy without altering retained records. Core Activity remains unchanged.

Scheduling and Overview use cancellable 30-second background reads while visible, immediate focus/reconnect refresh and error backoff. Open editors retain their state and revision. Overview links open the selected appointment directly; counts remain separate from Leads and Analytics. Booking settings exposes public metadata and configuration diagnostics without secrets.

The installation diff is limited to reviewed local runtime/UI/contracts packages and optional public scheduling metadata. Existing migrations 0001 through 0006, users, resources, forms, backend grants and installation entry points remain unchanged. Roll back the UI/runtime together to the previously reviewed source; retained scheduling records require no data rollback. Pause public booking in its existing settings when necessary. Published registry pins and all production-mode work remain deferred to a separate release.

Acceptance now includes an already-open calendar with an unsaved draft, an open Overview, refresh error/backoff/visibility/reconnect behavior, mobile connection diagnostics, scoped summary/details access, original policy after edits, and an end-to-end flow using packed website/admin/contracts/initializer packages installed outside both workspaces. No real provider or email transport is used.

Final integration verification on October 30, 2026: `npm run check` passed the build, strict typecheck and all 94 tests with zero skips, including the packed-package browser flow and automatic updates in both the calendar and Overview. Website typecheck, both scheduling compiler tests and the public package audit also passed. Screenshots and the verification receipt are retained in ignored `artifacts/admin-booking-integration/` and `artifacts/website-booking/`.

The updated isolated preview uses website `http://localhost:4396/book` and admin `http://localhost:4395/#scheduling`, leaving the existing previews on 4391/4392 alone. It uses only ephemeral local D1, simulated Google/Outlook transports, the explicit loopback challenge fixture and captured email. Launch it with `npm run booking:preview -- --website-port 4396 --admin-port 4395`; data resets when that process stops.
