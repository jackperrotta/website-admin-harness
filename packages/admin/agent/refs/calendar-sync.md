# Calendar synchronization setup and operations

This unreleased source supports Google Calendar and Microsoft Outlook calendars for staff providers. It requires reviewed runtime packages, explicitly enabled scheduling, migrations through `0005_calendar_sync.sql`, business-owned OAuth apps, and a scheduled Worker. Nothing here provisions, deploys, or migrates a remote installation. The published `0.1.0-alpha.1` does not contain these changes.

## Try it locally

From this source repository run `npm ci`, `npx playwright install chromium`, then `npm run scheduling:preview`. Open **http://localhost:4391/#scheduling** and choose **Open local demo**. Calendar connections clearly labels the simulated Google and Outlook accounts. Both are enabled for the synthetic staff. **Open simulated calendars** lets you add external busy events or delete an exported appointment to test conflict recovery. Create, reschedule, approve, or cancel appointments in Scheduling; inspect the simulated events and download an `.ics` file from appointment details. Use Sync now or wait for the preview's one-minute poll. Booking commits always refresh required calendars.

The preview uses real local workerd/D1 and the real adapters with simulated provider HTTP. It never contacts real providers by default, sends no email, and keeps no data after shutdown. It must not be exposed publicly.

## Real account acceptance

Register dedicated test calendars before testing live accounts. Stop any preview on port 4391. Put the values below in ignored `.dev.vars.calendar` (never source, manifests, browser code, screenshots, or command arguments). Start `npm run scheduling:preview -- --live --env .dev.vars.calendar`. The npm command rebuilds first. This ephemeral installation starts without connected calendars or appointments. Connect staff through Calendar connections, choose calendars, and explicitly accept event writes. Test appointments **do write real calendar events** after a connection is enabled. Customer messages remain captured.

```dotenv
CALENDAR_SYNC_ENABLED=1
CALENDAR_GOOGLE_CLIENT_ID=REPLACE_WITH_GOOGLE_WEB_CLIENT_ID
CALENDAR_GOOGLE_CLIENT_SECRET=REPLACE_WITH_GOOGLE_WEB_CLIENT_SECRET
CALENDAR_MICROSOFT_CLIENT_ID=REPLACE_WITH_MICROSOFT_APPLICATION_ID
CALENDAR_MICROSOFT_CLIENT_SECRET=REPLACE_WITH_MICROSOFT_CLIENT_SECRET_VALUE
CALENDAR_MICROSOFT_TENANT=common
CALENDAR_TOKEN_KEYS='{"current":"v1","keys":{"v1":"REPLACE_WITH_BASE64URL_32_RANDOM_BYTES"}}'
```

Omit a provider's two credentials when not testing it. Generate a key with `node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"` directly in your own terminal; save it only in the ignored environment or secret store. Refresh tokens are AES-GCM encrypted with site, connection, purpose and key version bound to the ciphertext. To rotate, retain the old key in `keys`, add a new random key and update `current`; refreshed credentials use the current key. Keep old keys until every retained connection has been refreshed or reconnected, and preserve recovery keys in protected backups.

### Google

1. In the business's Google Cloud project, enable the Google Calendar API. Configure the OAuth consent screen, intended audience and test users if in testing. Follow Google's current verification requirements before customer rollout.
2. Create an OAuth client of type **Web application**. Add the exact redirect URI below. For a deployed admin, add its exact HTTPS URI instead of substituting a wildcard.
3. Set the client ID and secret in the server environment. The integration requests `calendar.events` and `calendar.calendarlist.readonly`, offline access and consent. It requires the full scopes and an initial refresh token; declined or incomplete consent does not create a working connection.

Local callback: `http://localhost:4391/api/scheduling/oauth/google/callback`

Deployed callback: `https://ADMIN_HOST/api/scheduling/oauth/google/callback`

See [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Calendar event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

### Microsoft / Outlook

1. Register an application in the business's Microsoft Entra tenant. To serve both organizational and personal Outlook accounts, choose the corresponding supported account type. Set `CALENDAR_MICROSOFT_TENANT=common`; use `organizations`, `consumers`, or a tenant GUID only when deliberately narrowing access.
2. Add a **Web** platform with the exact redirect URI below. Create a client secret; use its secret **value**. Configure delegated permissions `User.Read`, `Calendars.ReadWrite`, and `offline_access`. Organizational policy may require administrator consent.
3. Set the application ID and secret server-side. The adapter uses delegated `/me/calendars` and expanded `calendarView`, supporting personal and organizational calendars subject to granted access and policy.

Local callback: `http://localhost:4391/api/scheduling/oauth/microsoft/callback`

Deployed callback: `https://ADMIN_HOST/api/scheduling/oauth/microsoft/callback`

Use the same `localhost` spelling in the browser, manifest and registrations. A different port or `127.0.0.1` requires a matching canonical manifest and provider registration; don't silently change origins. See [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [redirect restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url), and [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0).

## Review before deploying

For each installation, back up D1 and its encryption key ring. Review/apply migration 0005 explicitly after 0004, deploy the reviewed runtime and UI together, retain its existing resources and entry points, and enable the environment variables above. Store client secrets and the entire key-ring JSON as Worker secrets using the established protected input workflow. Never use the fixture transport or fixture mode in production.

Preserve the `scheduled` handler returned by `createAdmin` when wrapping the Worker. Add this explicit opt-in cron trigger to the installation's reviewed Wrangler configuration:

```json
{"triggers":{"crons":["* * * * *"]}}
```

No installer adds this trigger or changes an existing backend. The source preview runs a local polling timer; deployed installations use Cloudflare cron. This release uses bounded complete snapshots, **not webhooks or incremental sync tokens**. It checks calendars at roughly one-minute intervals and refreshes again before accepting a booking, approval, or reschedule. Busy-state changes invalidate native availability revisions. A provider can still change after the last read: later synchronization records overlaps for review; cross-provider transactions cannot be atomic.

Acceptance must include each real provider: consent and reconnect, calendar selection, a recurring occurrence and exception, all-day busy event across DST, free event, booking, pending approval, approval, reschedule, staff reassignment, cancellation, expired hold, provider-side edit/deletion, credential revocation, retry, disconnect, own-scoped access and encryption-key rotation. Verify scheduled polling on the deployed canonical hostname. Simulated tests do not prove live consent, provider policy, notification delivery, or deployment.

## Behavior and recovery

- Owners/administrators manage connections; other accounts need an explicit `calendar-connections:manage` grant. The Team editor has an own-calendar preset. Own scope is restricted to staff profiles linked to that account. Removing account access pauses its connection until an authorized account reconnects.
- Each staff profile can connect one Google and one Microsoft account. Select up to five blocking calendars per connection and one writable appointment destination. The destination also blocks availability. Calendar lists and paginated expanded occurrences are bounded; incomplete/oversized results fail closed. The import window spans yesterday through the configured booking horizon plus a safety day.
- Busy and tentative events block time; free/cancelled events do not. Google working-location and Microsoft working-elsewhere events are free. All-day Google dates use the calendar's IANA timezone; Microsoft responses are requested in UTC. Recurrence expansion is performed by each provider.
- Native appointments are authoritative. Exports contain the service, customer name, times, pending/confirmed state, a stable private identity marker, and private visibility. They contain no customer email or attendees and send no invitations. Pending approvals are busy holds; decline/cancellation/expiry removes linked events. Actual appointment times are exported; preparation/cleanup buffers remain native reservations.
- Export jobs are enqueued in the same native transaction, with stable event identities, conditional updates, retries and duplicate recovery. An external outage never erases a saved appointment. Required calendars with errors, stale/unverified snapshots, or pending writes pause new times. Cancellation remains possible. Retry via Sync now; reauthorize if credentials were revoked.
- Changes to exported events become review conflicts; they never silently reschedule or cancel the customer appointment. View the appointment, then explicitly **Apply appointment to calendar** to restore native values. Foreign events are never edited. A foreign overlap is shown for manual rescheduling; other free times remain bookable.
- A destination with retained active links cannot be switched. Use the current destination until links are resolved. Disconnect requires acknowledgment, stops blocking/exports and clears stored credentials; previously exported remote events remain. Reconnecting creates a fresh connection and may export existing future appointments again. Review/clean up retained events in the provider first to avoid duplicates or old busy events.
- Existing migrations and historical fixtures remain unchanged. To pause new scheduling, use Booking settings. Do not merely remove encryption settings or disable sync while calendars remain required; that intentionally fails closed. Do not remove the schema while deployed code or retained appointments use it. Rollback requires its own reviewed data-preserving release.

## Universal calendar files and email

Appointment details offer an authenticated `.ics` download. Captured notification payloads include the same attachment (`text/calendar`, UTF-8). Files follow RFC 5545 with stable UID, revision SEQUENCE, UTC times, cancellation status, escaped values and UTF-8 line folding. These are calendar snapshots, without iTIP invitation methods or invented organizer addresses. Import behavior, update matching and cancellation handling vary by client; the file is not a calendar subscription and cannot expose external busy times.

Actual scheduling email delivery remains a later slice. This release stores attachment captures; it does not send email or claim delivery. The eventual mail adapter can attach this file to confirmations/changes using the business's verified sender. Automated meeting invitations and reliable invitation cancellations would additionally need the business organizer identity and an iTIP delivery workflow. See [iCalendar RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) and [iTIP RFC 5546](https://www.rfc-editor.org/rfc/rfc5546).
