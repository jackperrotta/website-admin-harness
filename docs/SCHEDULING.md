# Scheduling foundation

The unreleased scheduling module provides a dedicated admin calendar, management screens, shared contracts and an opt-in authenticated API. It works independently of a website leads/analytics backend. It supports test appointments, staff and exclusive resources, weekly availability and exceptions, approval, cancellation, staff rescheduling, scoped access, history, idempotent commands, and captured notification/calendar jobs.

Google and Microsoft calendar sync and universal `.ics` files are now implemented in this source. See [calendar setup and operations](../packages/admin/agent/refs/calendar-sync.md) for OAuth credentials, exact callbacks, encryption, cron, local simulation and live acceptance. A test-mode public website booking API and standard component now accept guest appointments into the same admin calendar. See [public booking setup](../packages/admin/agent/refs/public-booking.md). Customer email and management links are implemented behind explicit settings; see [setup and recovery](../packages/admin/agent/refs/customer-notifications.md). Production activation and designated real-mail acceptance remain separate. A captured job is not proof of delivery. The existing published alpha must not be treated as containing this source change.

## Local enablement

Use an isolated installation built from reviewed local packages. Apply numbered migrations through `0006_public_booking.sql` to its local database, then explicitly add `scheduling` to its local manifest's `modules`. `createAdmin(config)` registers the built-in module; do not scaffold a custom module with that ID. Module enablement does not configure availability or activate booking. New installations continue to omit scheduling by default.

Keep production manifests, databases, and customer installations separate. Existing installs need their own package/schema review and backup before a remote migration; no setup command performs it automatically. Calendar sync is explicitly opt-in through server credentials, encryption settings and cron. Enabled calendar connections receive real event writes even in test mode. Customer messages remain captured.

Owners and administrators can configure the module. Other existing roles receive no scheduling access automatically. A configuration grant can permit all appointments or only appointments assigned to provider resources linked to that account's `userId`. Providers can exist without an account. Own-scoped availability changes are limited to the account's linked providers. Account revocation, permissions, and target resource scope are checked again inside the write transaction.

The Scheduling navigation item opens a dedicated, lazy-loaded workspace. Existing admin host, session and mutation Origin protections apply to every route. Website-origin requests gain no admin authority. The separate public API has its own publication, Origin, challenge and guest-command checks.

## Admin calendar and management

Calendar supports day, week and seven-day agenda views, date navigation, explicit calendar timezone, and location, staff and status filters. Mobile starts in agenda view; the week board scrolls within its container. Appointments ending exactly at midnight do not appear twice across days. A bounded-result notice asks the operator to choose a shorter range when more than 200 appointments match.

Owners and administrators can configure a new installation entirely through the UI: add a location and timezone in Booking settings, add staff or resources in Team, create Services, set business and resource hours in Availability, then select Test mode. Rooms, bays and equipment have their own working hours and are reserved alongside staff. Deactivating services, resources or locations preserves appointment history.

Services expose duration, pricing, buffers, eligible staff, locations, required resources, and per-service confirmation rules. Team supports linking existing accounts and explicitly granting own/all scheduling access; it does not create or change account roles. Custom permissions are retained unless the operator chooses a replacement preset. Availability supports split weekly shifts, multiple locations, time off and extra dated availability. Repeated clock-change times offer explicit UTC-offset choices, and nonexistent local times are rejected.

Appointment forms search server-calculated times, display current service terms, and save with the returned revision. Staff can approve, decline, cancel, reschedule, or mark eligible appointments completed/no-show. Detail views retain original price and policy snapshots and show stored history. Lost responses can be retried with the same command identity, without duplicating an appointment. Failed or conflicting writes keep the draft visible; refresh before replacing a draft from an older configuration.

Provider-scoped users receive only permitted controls and assignments. They do not receive the configuration/grant map or account directory. Resource availability changes remain scoped to linked providers. Calendar connections provides scoped Google/Outlook connection, selection, health, retry, disconnect and conflict recovery. The separate source preview clearly labels simulated providers; production mode remains unavailable.

## Shared contracts

Import public scheduling DTOs, constants and strict parsers without loading the admin Worker:

```ts
import {
  schedulingContractVersion,
  emptySchedulingConfig,
  parseSchedulingConfig,
  type SchedulingConfig,
  type CreateAppointmentRequest,
} from '@tryvitris/website-admin-contracts/scheduling';
```

The root contracts entry point re-exports the same scheduling module. Schema version 1 currently accepts `disabled` and `test`, and rejects `live`. Unknown request fields are rejected, including browser-supplied site identity, price and status on creation. Timestamps are explicit ISO UTC instants at a whole minute. Timezones use IANA identifiers. Prices use integer minor units and an explicit currency; `null` means the price is not fixed, with a descriptive label.

Configuration is a bounded, validated aggregate per site, updated through optimistic revision checks. It contains locations, resources, services, weekly windows, dated exceptions and grants. Operational appointments, exclusive resource reservations, command receipts, history and captured jobs are relational records. Appointment snapshots retain the original service duration, buffers, price and approval terms when service configuration changes or staff reschedule an appointment.

## Authenticated API

All paths below start with `/api/modules/scheduling`. POST requests require a signed-in session, JSON, and the exact admin Origin.

| Method and path | Behavior |
| --- | --- |
| GET `/status` | Contract version, mode, global revision, effective permissions, own/all scope, public-booking flag and calendar integration readiness |
| GET `/workspace` | Permission-filtered catalog and status; full configuration and a bounded account picker only for configuration managers |
| GET `/configuration` | Complete configuration; requires `scheduling:configure` |
| POST `/configuration` | `{revision, config}`; atomically replace validated configuration and increment the global revision |
| GET `/availability` | `serviceId`, `locationId`, optional `providerId` and authorized `appointmentId`, `startsAt`, `endsAt`; at most seven days and 500 slots, with current terms and location metadata. Reschedule searches preserve the appointment's terms and exclude its existing claims. |
| GET `/availability-settings?resourceId=ID` | Authorized resource's weekly hours and exceptions |
| POST `/availability-settings` | `{revision, resourceId, weeklyHours, exceptions}`; cannot change another resource through an own-scoped grant |
| GET `/` or `/appointments` | At most 200 permitted appointments overlapping an optional range of up to 31 days; includes `truncated` |
| GET `/appointments/ID` | Authorized appointment details and original policy snapshot |
| POST `/appointments` | Create a test appointment under current rules; returns its ID and revisions |
| POST `/appointments/ID/status` | Allowed approval, decline, cancellation, expiry, completed or no-show transition |
| POST `/appointments/ID/reschedule` | Staff-authorized replacement time, location and provider, with atomic reservation replacement |
| GET `/appointments/ID/history` | Site- and assignment-scoped appointment events |
| GET `/jobs` | Captured synthetic outputs only; requires `scheduling:configure` |

Each appointment command requires a unique `idempotencyKey` and current global `revision`. Status and reschedule commands also require `appointmentRevision`. Retrieve the global revision from configuration, status, availability, or the appointment list. Mutation responses return `scheduleRevision` and the appointment `revision`. A successful identical retry returns the original receipt; the same key with different content or another actor is a conflict. Receipts are reauthorized against current appointment ownership.

Configuration payloads are bounded to 128 KiB and validated aggregates to 100,000 characters. Availability settings are bounded to 64 KiB, other mutations to 8 KiB. Lists, resource assignments and date ranges have additional contract limits. Error responses use `code` and `error`; conflicts use HTTP 409, unauthorized scope uses 403 or an intentionally indistinguishable 404, and validation uses 400.

## Synthetic configuration example

This example offers one appointment service on Mondays from 9 am to 5 pm in New York. Location and resource hours must both cover the entire occupied interval, including buffers. A room or equipment requirement also needs its own hours. Split overnight hours across adjacent weekdays. Explicit closed exceptions take precedence over open exceptions and weekly windows.

```json
{
  "schemaVersion": 1,
  "mode": "test",
  "defaultBookingMode": "instant",
  "minNoticeMinutes": 60,
  "horizonDays": 90,
  "slotStepMinutes": 15,
  "approvalTtlMinutes": 1440,
  "locations": [
    {"id": "main", "name": "Synthetic office", "timezone": "America/New_York", "active": true}
  ],
  "resources": [
    {"id": "provider-a", "name": "Synthetic provider", "kind": "provider", "locationIds": ["main"], "active": true}
  ],
  "services": [
    {
      "id": "consultation", "name": "Synthetic consultation", "active": true,
      "durationMinutes": 30, "bufferBeforeMinutes": 0, "bufferAfterMinutes": 15,
      "bookingMode": "inherit", "locationMode": "business",
      "locationIds": ["main"], "providerIds": ["provider-a"], "resourceIds": [],
      "price": {"amountMinor": 5000, "currency": "USD", "label": "Fixed price"}
    }
  ],
  "weeklyHours": [
    {"locationId": "main", "weekday": 1, "startMinute": 540, "endMinute": 1020},
    {"locationId": "main", "resourceId": "provider-a", "weekday": 1, "startMinute": 540, "endMinute": 1020}
  ],
  "exceptions": [],
  "grants": []
}
```

Use the configuration inside `{ "revision": CURRENT_REVISION, "config": CONFIGURATION }`. Names and services above are synthetic and must be replaced through an explicit business configuration step.

## Reservation and lifecycle guarantees

Every command starts with a transactional revision guard. Configuration changes, availability changes and appointment commands increment the same site revision, so a calculation based on stale rules cannot commit. This intentionally conservative foundation may return a conflict for simultaneous edits to unrelated appointments; the caller reloads and retries.

Appointment triggers create or replace every exclusive resource claim in the same transaction. Claims are indexed by site and resource, not location, so a provider cannot be booked at two locations at once. Half-open intervals permit adjacent appointments unless a buffer occupies the boundary. A shared room blocks other providers as well. Any overlapping claim aborts the entire transaction, retaining the old appointment and reservations on failed rescheduling. Jobs, history and command receipts roll back with it.

Creation derives immediate confirmation or pending approval from the service's explicit mode or the business default. Pending requests reserve resources until their stored deadline, bounded by the start time. Expired claims stop blocking immediately based on their deadline and cannot be approved. Reads report their effective expired status; a status command can materialize `expired` in history. The calendar runner materializes expired holds for connected providers and removes their linked events; native deadline checks apply even without a runner. Cancelling existing appointments remains possible when new booking is disabled.

Rescheduling here is an authenticated staff action. A customer's proposed reschedule requiring approval, including holding a replacement while retaining the original booking, is not part of this slice. Customer cancellation and rescheduling cutoffs will be enforced by the later public command layer. Staff status changes do not imply that a notification was delivered.

Availability expands real instants in the location timezone. The repeated autumn hour produces distinct UTC times, while nonexistent spring times are omitted. Appointment durations measure elapsed time. The first version requires known duration, one eligible provider, and up to seven explicitly required exclusive resources. Alternative resource pools, classes, processing-time overlap and route planning remain extensions.

## Verification

Run `npm ci` and `npx playwright install chromium`, then `npm run check`. Tests use strict parsers, synthetic configurations and real local workerd/D1. Coverage includes retained pre-migration users/leads, concurrent bookings and retries, shared resources, cross-location conflicts, full transactional rollback, expiry, price/policy snapshots, disabled modes, account revocation, grant scoping, cross-site IDs, Origin protections and daylight saving transitions. Package acceptance installs packed runtime and contract archives outside the workspace, checks the scheduling export and declarations, and builds an explicitly opted-in installation.

Chromium acceptance exercises the built UI against real local D1, including an empty-installation setup, service and staff editing, availability, appointment lifecycle, scoped mobile access, stale drafts, lost responses, explicit DST offsets and current pricing after concurrent edits. Screenshots and verification output stay in ignored `artifacts/scheduling-ui/`. The UI is loaded only when opening Scheduling and follows the existing website-derived admin palette.

No tests in this slice connect to a real calendar or prove notification delivery. Subsequent calendar adapters must pass designated real-account acceptance before scheduling is launched.

## Calendar routes

Connection and download routes use the same authenticated API prefix. See the setup reference for the callback exception and full behavior.

| Method and path | Behavior |
| --- | --- |
| GET `/connections` | Safe scoped connection health, readiness and conflict list; never tokens |
| POST `/connections/start` | `{provider, resourceId}` begins state/cookie/PKCE-bound OAuth |
| GET `/connections/ID/calendars` | Scoped calendar choices and connection revision |
| POST `/connections/ID/select` | `{revision, blocking, destination, acknowledge}` enables sync after consent |
| POST `/connections/ID/sync` | `{}` retries synchronization |
| POST `/connections/ID/disconnect` | `{revision, acknowledge}` stops sync and clears credentials |
| POST `/connections/ID/restore` | `{appointmentId, acknowledge}` explicitly restores native authority |
| GET `/appointments/ID/calendar.ics` | Authorized calendar snapshot download |
| GET `/appointments/ID/notification` | Read-only captured notification payload with calendar attachment |

OAuth alone uses exact canonical GET `/api/scheduling/oauth/google/callback` or `/api/scheduling/oauth/microsoft/callback`, with single-use state, a short-lived HttpOnly SameSite=Lax flow cookie, PKCE, and current account/scope reauthorization. The normal Strict admin session cookie is not required on that provider redirect.

Customer notification migration 0007 adds durable emails and independent customer management authority. Review the packaged customer-notifications reference, preserve earlier migrations, and configure the provider and encryption explicitly. Customer sessions never grant admin access.

## Configurable reminders

Booking settings now include optional appointment reminder emails with one to three unique lead times, from 1 minute to 30 days. Reminders use current business settings, confirmed appointments only, the existing capture/send mode, calendar attachments and private customer links. Apply additive migration 0008 and retain the one-minute scheduled handler. Future due times apply to existing and new confirmed appointments; overdue times are skipped, with a 15-minute processing grace period. Rescheduling, approval, recipient/configuration changes, cancellation and ambiguous sends are fenced and deduplicated. See packaged `agent/refs/customer-notifications.md` for exact eligibility and recovery rules.
