# Customer emails and appointment links

This source adds transactional appointment emails, calendar attachments, and appointment-scoped customer cancellation/rescheduling. It does not activate a production release. Keep existing accounts, origins, databases and earlier migrations intact; apply additive migrations `0007_customer_notifications.sql` and `0008_appointment_reminders.sql` only through a reviewed installation change. No existing appointment is emailed as a migration side effect.

## Business settings

In Scheduling → Booking settings, explicitly enable customer emails. Capture mode stores private test emails in Scheduling → Customer emails. Send mode is for explicitly allowed test recipients; scheduling remains test-only. The mode is saved on each new outbox entry, so changing to Send never releases old captures to customers.

Enable customer links and set cancellation/rescheduling notice in minutes. Zero permits changes until the appointment starts. Rules are snapshotted onto new appointments; changing cutoffs applies to future bookings. Existing appointments without that snapshot do not gain customer authority automatically. Turning customer management off pauses online changes, while preserving the appointments. New booking can be paused while eligible customer cancellations continue. Rescheduling is unavailable when the scheduler is paused.

Customer rescheduling keeps the original service, staff, location, price, duration and approval terms. It atomically replaces reservations only after checking current availability and required external calendars. A pending request stays pending and retains its original approval deadline, bounded by the replacement start; changing time does not approve it or extend a hold indefinitely. A failed/conflicting reschedule leaves the original reservation intact.

Emails cover confirmed bookings, requests awaiting approval, approval, rescheduling, cancellation, decline and expired requests. Each contains the original service terms, location timezone/offset, reference, notice rules and a UTF-8 `.ics` snapshot. Approval requests never claim to be confirmed. Calendar UID stays stable and SEQUENCE follows the native appointment revision; terminal notices carry cancellation status. These files are snapshots without iTIP invitation methods or an invented organizer, so client import/update behavior varies.

## Appointment reminders

In Scheduling → Booking settings → Appointment reminders, enable reminders and choose one to three different lead times in minutes, hours or days. The supported range is 1 minute to 30 days, at whole-minute precision. Defaults shown in the editor are 24 hours and 2 hours; reminders remain off until explicitly enabled and saved. Customer emails must also be enabled. For example:

```json
{"notifications":{"enabled":true,"mode":"capture","reminders":{"enabled":true,"offsetsMinutes":[1440,120]}}}
```

Current business settings govern reminders for existing and new confirmed appointments. Pending approval, cancelled, declined, expired, completed and no-show appointments do not receive reminders. Approval, rescheduling, customer-detail changes and notification-setting changes establish a new eligibility window: only reminder times still in the future qualify. Applying migration 0008 does not send historical mail or change existing appointments/captures. It starts eligibility for retained confirmed appointments at migration time. Pausing new booking does not stop reminders for existing appointments; disable reminders or customer emails to stop them.

The existing one-minute scheduled worker creates durable due reminder jobs. A reminder can run up to 15 minutes late, provided the appointment has not started; older missed reminders are skipped without a catch-up burst. Lead times are elapsed minutes before the appointment's absolute start, including across daylight-saving changes. Messages display the appointment's snapshotted timezone and offset. Cron and delivery are best effort, not an exact-time delivery guarantee.

Each appointment/start/lead-time has one durable identity. Overlapping runs cannot send it twice, and a harmless appointment revision cannot repeat an accepted/captured reminder. A replaced start gets its own future reminder times. The worker rechecks the current appointment, recipient, notification mode and settings inside its preparation/send transaction, suppressing obsolete work. Email already submitted to the provider cannot be recalled. Unknown sends stay uncertain and never automatically resend, even after an appointment revision. Explicit retries also recheck eligibility and the grace period; obsolete reminders become Superseded. Existing captures never become send-mode mail.

Reminders include the same original appointment terms, `.ics` snapshot and eligible private management links as confirmations. Scheduling → Customer emails shows processed reminders, their lead time, due time and delivery state. Future reminders are computed from the current appointment/settings rather than pre-enqueuing an unbounded calendar backlog. No new sender binding or provider is required beyond the existing customer-email setup.

## Server setup

Keep values in ignored local environment files or protected Worker secrets:

```dotenv
SCHEDULING_NOTIFICATIONS_ENABLED=1
SCHEDULING_TOKEN_KEYS='{"current":"v1","keys":{"v1":"REPLACE_WITH_BASE64URL_32_RANDOM_BYTES"}}'
SCHEDULING_EMAIL_FROM=appointments@BUSINESS.example
SCHEDULING_EMAIL_REPLY_TO=contact@BUSINESS.example
SCHEDULING_TEST_RECIPIENTS='["OWNER_TEST_ADDRESS@BUSINESS.example"]'
BOOKING_MANAGE_PATH=/book/manage
```

Generate a fresh 32-byte key using the established secret-manager workflow, or run `node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"` in your own terminal. Never put it in source, a public manifest, command arguments, logs or screenshots. This ring is separate from calendar-provider credentials. Prepared messages/captures are AES-GCM encrypted, bound to the site, outbox ID and key version. Retain old keys for retained ciphertext when rotating `current`; active customer capabilities are hashed separately and do not rely on decrypting an email.

For sending, onboard the business sender domain with Cloudflare Email Service and add a restricted `send_email` binding named **SCHEDULING_EMAIL**. Use `allowed_sender_addresses` for the business sender and provider recipient restrictions appropriate to the account. Sending also requires the recipient to appear in `SCHEDULING_TEST_RECIPIENTS`; capture mode never calls the provider. Missing sender, missing binding or unapproved recipients block that email before sending, without deleting the appointment.

The implementation uses the structured builder with `to`, `from`, `replyTo`, `subject`, `text`, `html` and base64 calendar attachments. It does not override platform-generated Message-ID or MIME headers. See [Workers sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [sender/recipient restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/) and [header rules](https://developers.cloudflare.com/email-service/reference/headers/). Sender/domain onboarding, account availability and actual inbox receipt must be verified separately with designated recipients.

Preserve the `scheduled` handler returned by `createAdmin` and explicitly configure a one-minute cron. It processes due reminders and durable email work and materializes expired approval holds even without calendar connections. No setup command adds cron, secrets or remote resources automatically. Keep the existing public `BOOKING_RATE_SECRET` and exact website origin configured for customer management, including while new booking is paused.

The website compiler adds the management page at the booking route plus `/manage`. For custom routes, set `BOOKING_MANAGE_PATH` to that exact generated path. It must remain a path on the configured website origin; there is no browser-supplied redirect destination.

## Customer authority and privacy

Each email link uses a cryptographically random capability for one appointment and its current recipient. It appears only in a URL fragment. The page's first script removes the fragment/query before other scripts, omits the harness analytics/beacon, and requires **View appointment** before exchanging it for a 30-minute in-memory bearer session. Opening a link or issuing GET requests never changes an appointment. Reopening a valid original email link can create another session; the email capability itself is not consumed by a scanner or a viewing session.

Email links expire at the appointment start, bounded to 366 days. Expired requests and terminal appointments revoke authority; changing the recipient revokes the previous recipient's tokens. Cancellation revokes all mutation access. A successful command can still replay its own original receipt with the same request/session proof until that session expires, even after cancellation, allowing safe recovery from a lost response. It cannot read another appointment or replay after a recipient change.

Management uses POST `/api/booking/v1/manage/exchange`, `/appointment`, `/availability`, `/cancel` and `/reschedule`. Requests require the exact website Origin; authenticated requests use `Authorization: Bearer ...`, never admin cookies. The command guard rechecks session, recipient, appointment status, snapshotted notice rules and revisions inside the native transaction. Each command has a UUID and content-bound receipt. Customer links cannot select another appointment, staff member, location, price or status.

Do not put capabilities in query strings, analytics, referrers, browser persistence, log output, public receipts or public notification APIs. The website keeps session and retry proof only in memory; after an expired session, reopen the original valid email link. Public link recovery/resend and customer accounts are not implemented. Customer details/capabilities stay out of other customers' availability responses.

## Delivery states and recovery

Native writes enqueue notification work in the same D1 transaction. Captures are private and require current `scheduling:configure` authority to inspect. The admin preview document is sandboxed, uncached and script-free; its narrowly scoped CSP permits email inline styles without weakening the rest of admin.

- **Pending/preparing:** durable work waiting for processing. Older unsent revisions are superseded if the appointment already changed.
- **Captured:** a private test message was prepared; it was not sent.
- **Blocked:** preparation or sender setup failed before sending. Fix the listed setup and explicitly retry.
- **Sending:** the provider call is in progress.
- **Accepted:** Cloudflare returned a message ID. This is provider acceptance, not proof of mailbox delivery.
- **Unknown:** the send response was lost, invalid or interrupted. A stale in-flight lease also becomes Unknown. It is never automatically resent, because it may already have been accepted.

Review the provider/mailbox before retrying an unknown send. Admin requires explicit acknowledgment because another email may result. Retries reuse prepared content and management links; they never create another appointment. Accepted messages are not retryable through this action. Delivery/bounce webhooks and recipient recovery flows remain later work; do not label acceptance as delivered mail.

## Local verification

With both source repositories present, `npm run booking:preview` serves the customer website at **http://localhost:4392/book** and admin at **http://localhost:4391/#scheduling**. Book a new appointment, open local demo in admin, then Scheduling → Customer emails → Preview email. Download the attachment or open either private customer link. The preview uses real local D1, captured emails and explicitly simulated calendar providers. No real email is sent.

Run admin `npm run check`, website typecheck/tests and packed-package verification. Paired browser acceptance proves email capture, admin inbox, clean fragment handling, cancellation/rescheduling, calendar updates, lost-response recovery, retained reservations after conflict and mobile accessibility. Provider send tests use an isolated Cloudflare-binding fixture, not a real mailbox. Record designated sender/inbox acceptance separately before any rollout. Never send customer test notifications or deploy/migrate a shared backend as a setup side effect.
