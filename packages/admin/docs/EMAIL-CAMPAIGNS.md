# Cloudflare email campaigns

The optional `email-campaigns` module adds customer reports, service communications, contacts, segmentation, structured templates, newsletter drafts, scheduling, and guided website workflows. Every business uses its own Cloudflare account, Worker, D1, R2, sender identity, feedback queue, users, and records. No external email provider is included.

Cloudflare Email Service supports transactional email only. Customer reports and responses must relate to a specific interaction or agreed service. Promotional newsletters, sales nurturing, and upselling are not enabled. Newsletter composition, article-to-newsletter drafts, preference collection, and recurring issue drafts are available; newsletter delivery remains unavailable pending confirmation of permitted use. See [Cloudflare's FAQ](https://developers.cloudflare.com/email-service/reference/faq/).

## Prepare an existing Worker installation

Install the exact compatible runtime and contracts packages using the installation's existing update/build workflow. Preserve authored entry points, configuration, users, forms, origins, and secrets. The module is not enabled by a normal package update or initializer.

Prepare a local configuration file with this business's public resource identifiers. Credentials do not belong in this file:

```json
{
  "from": "reports@business.example",
  "module": {
    "feedbackQueue": "business-email-feedback",
    "accountId": "BUSINESS_ACCOUNT_ID",
    "zoneId": "BUSINESS_ZONE_ID",
    "sendingDomain": "business.example",
    "eventSubscriptionId": "BUSINESS_EVENT_SUBSCRIPTION_ID",
    "dailyLimit": 1000
  }
}
```

The daily limit is an operator-verified account quota, not an entitlement supplied by the package. For a capture-only local installation, only the sender and feedback queue name are required. Keep actual installation configuration outside this public repository.

```sh
vitris-admin email-setup --dir EXISTING_ADMIN --from EMAIL_CONFIG.json --plan
vitris-admin email-setup --dir EXISTING_ADMIN --from EMAIL_CONFIG.json --apply
```

Review `.vitris/email-setup/plan.json` before applying. The plan includes the exact manifest, Worker, Wrangler, module-source, and new migration diff. Apply checks the baseline, CLI/version/configuration digests, permitted paths, and links, and keeps private backups. It never provisions, migrates a remote database, deploys, creates a subscription, or sends email. Custom Worker compositions outside the supported static forms require a manual import/modules diff. Existing Pages installations use the separate private Worker strategy below.

Use `--local` for `admin.local.json`, `worker.local.ts`, and `wrangler.local.jsonc`. It requires an exact loopback admin origin. Apply the reviewed new migration locally, build, and open the existing local admin. Configure local-only encryption/identity keys through an ignored `.dev.vars` file; captures are encrypted too. Normal local demo access still requires both local mode and an exact loopback origin.

The runtime export can also be wired explicitly:

```ts
import {createAdmin} from '@tryvitris/website-admin-harness/worker';
import {createEmailCampaigns} from '@tryvitris/website-admin-harness/email-campaigns';
import manifest from './admin.config.json';

const email = createEmailCampaigns({feedbackQueue:'business-email-feedback'});
export default createAdmin(manifest, {modules:[email]});
```

Include the ID in the intended manifest only. Preserve the returned `fetch`, `scheduled`, and `queue` handlers in custom wrappers. The optional schema is shipped in `modules/email-campaigns/migrations/0001_email_campaigns.sql`; copy it to the next unused migration number in the installation. Never overwrite an existing migration. `email-setup` prepares that copy for review.

## Native mail and delivery feedback

Provision and onboard resources only for the explicitly authorized business account. Preserve existing mailbox MX records, authentication senders, and appointment email bindings. Configure a restricted native binding:

```json
{"send_email":[{"name":"CAMPAIGN_EMAIL","allowed_sender_addresses":["reports@business.example"]}]}
```

Merge this with existing bindings. Do not replace `AUTH_EMAIL` or `SCHEDULING_EMAIL`. Verify sender-domain onboarding, SPF, DKIM, DMARC alignment, the monitored Reply-To mailbox, permitted message purposes, and actual sending quota. Configure these protected installation values:

| Value | Purpose |
| --- | --- |
| `CAMPAIGN_FROM` | Exact sender permitted by the binding |
| `CAMPAIGN_TOKEN_KEYS` | AES-GCM ring: `{"current":"v1","keys":{"v1":"BASE64URL_32_RANDOM_BYTES"}}` |
| `CAMPAIGN_ID_KEY` | Separate stable 32-byte random value encoded as base64url; protects contact/suppression identities |
| `CAMPAIGN_WEBSITE_KEY` | Separate random base64url signing secret for the approved website producer |
| `CAMPAIGN_TURNSTILE_SECRET` | Website's real challenge secret for optional signup |
| `CAMPAIGN_TEST_RECIPIENTS` | JSON array of explicitly approved live test addresses |
| `CAMPAIGN_EMAIL_READY` | Set to `1` after independently verifying sender configuration |
| `CAMPAIGN_FEEDBACK_READY` | Set to `1` after independently verifying feedback subscription/consumer |
| `CAMPAIGN_SEND_ENABLED` | Keep `0` until this installation's live sending is authorized and ready |

Generate secrets privately and install them using protected stdin or the existing secret manager. Never print them, pass them in command arguments, put them in public assets, or commit them. Preserve `CAMPAIGN_ID_KEY` for retained contacts and suppression records. Preserve old encryption keys while encrypted records remain. Restoring D1 without its keys does not restore usable queued mail.

Configure a one-minute cron and the exact feedback consumer/dead-letter queues from the reviewed Wrangler diff. Configure a Cloudflare Email Sending event subscription for the verified sending domain, targeting the business's feedback queue. Supply its exact account, zone, domain, subscription, and queue identities to `createEmailCampaigns`. The consumer checks those identities, sender, schema, time, recipient, and message identity; it deduplicates events and retains suppression processing when sending is disabled. Invalid events are rejected without logging their bodies. Storage failures retry and reach the configured dead-letter queue for operator recovery. [Native event subscription documentation](https://developers.cloudflare.com/email-service/reference/event-subscriptions/).

Readiness in the UI reports configuration and operator readiness flags. It does not independently prove DNS, account ownership, inbox placement, or real delivery. Record provider acceptance separately from receiving-server acceptance and confirmed inbox receipt.

A verified complaint or recognized provider policy rejection pauses live submission for review. Hard bounces at 5% of at least 20 submitted messages in the last day also require review; these are conservative local pilot controls, not provider allowances. Missing lifecycle feedback for six hours holds further submission. Investigate the account and feedback consumer, resolve outstanding receipts, then use **Resume after delivery review**. Recipient suppressions remain in force. Replaying previously reviewed feedback does not clear a suppression or reopen the same alert.

## Contacts and sending

Owners initially receive the module permissions. Administrators, editors, analysts, Webmaster grants, and sign-on do not gain campaign authority implicitly. Server actions separately require contact read/write/export, content write, send, automation management, reporting, and settings permissions. Task-producing sequences also require task-writing authority. The current owner-only default can be expanded only through a reviewed access-model change.

Create contacts manually or preview a CSV import. Map column names before importing; invalid rows block commit and existing addresses are preserved. Imports resume from encrypted chunks and never subscribe contacts or clear suppressions. Record actual topic permission and an agreed service or customer-interaction reference before enabling the corresponding purpose. Double opt-in confirms an email preference; it cannot establish an unrelated service agreement.

Create a segment using all/any rules over stage, tags, source, company, service/interaction evidence, preferences, trusted events, or typed custom fields. Counts cover the full audience. Before approval, review the business sender, purpose, content, current eligible count, exclusions, schedule, mode, and limits.

Approval freezes recipient IDs, template/content revision, personalization, and capture/send mode. Large snapshots are bounded; split an unusually large audience if requested. Later opt-outs, suppression, address/authority changes, limits, pauses, and purpose eligibility can remove a recipient. They cannot add recipients to an approved campaign. Changing to Send never releases old captures as live mail.

Templates support headings, paragraphs, buttons, dividers, approved R2 images, safe links, subject/preheader, text alternatives, version history, and fallback personalization. HTML and script editing are not supported. Images are uploaded through the composer and served through a read-only asset path; private imports, exports, and recipient previews are never exposed there. Inspect saved desktop/mobile previews and use explicitly addressed captured or approved live tests.

Scheduling uses absolute UTC instants with the business timezone shown. Missing/repeated DST times require another selection. A scheduled time starts gradual processing; it is not an inbox-delivery deadline. Frequency, quota, and a bounded D1 workload can slow a large run. Captures are for local behavior checks, not proof of real delivery. Newsletter recurrence creates fresh drafts; it never silently sends an old issue.

## Website signup and events

Optional `email-setup --site WEBSITE` prepares public `launch.json.emailCampaigns` metadata after verifying exact origins. It preserves existing forms and backend fields. A local website connection requires loopback website and admin origins. Connection metadata does not enable collection or modify a collecting form.

The browser-safe `@tryvitris/website-admin-harness/email-campaigns/signup` export provides `subscribeToCustomerEmails`. Call it with the exact admin origin and a real Turnstile token created for action `email_subscribe`. Requests omit admin credentials. The server checks exact CORS origin, challenge action/hostname, bounded input, rate limits, and sends only a neutral preference confirmation. Newsletter confirmation does not enable newsletter delivery. Confirming requires POST; scanners opening GET links cannot subscribe or unsubscribe someone.

The server-only `@tryvitris/website-admin-harness/email-campaigns/website` export provides `prepareWebsiteEmailEvent`, `queueWebsiteEmailEvent`, and `flushWebsiteEmailEvents`. Apply `modules/email-campaigns/website/0001_website_email_outbox.sql` separately to the owning website's database through a reviewed change.

For an existing collecting form, include `await prepareWebsiteEmailEvent(...)` in the same authoritative D1 batch as the saved enquiry. Supply only the minimum typed contact/event data. Use the same event ID when retrying a submission. The outbox rejects changed payloads under the same ID, encrypts pending events, and retries signed delivery independently. A lost response cannot create duplicate enrollments. The original form receipt and notifications remain authoritative.

```ts
const statement = await prepareWebsiteEmailEvent(db, connection, credentials, event);
await db.batch([saveAuthoritativeEnquiry, statement]);
// In the website's existing scheduler or bounded background processing:
await flushWebsiteEmailEvents(db, connection, credentials);
```

Use `lead.created`, `service.updated`, `report.ready`, `customer.converted`, `enquiry.resolved`, and `subscription.confirmed` as defined by the typed contract. Signed reports contain fresh, scoped report values. Never forward arbitrary notes, test submissions, sensitive form fields, or browser-supplied role/consent claims as trusted events. The shared signing key and producer encryption ring stay on the server. Outbound email feedback does not contain replies; staff stop a sequence manually when a reply arrives in the monitored inbox.

## Workflows and reports

Guided sequences support send, wait, condition with forward skip, tag, stage, staff task, and exit. Publishing creates an immutable version with template snapshots. Active enrollments retain that version. Editing creates a new draft; paused or stale work does not produce catch-up bursts. Resolution/conversion, staff stop, opt-out, suppression, and revoked sender authority stop applicable future work. Re-entry is identified by distinct trusted event IDs, not by an arbitrary browser flag.

Recurring analytics reports use current data from the configured authoritative backend, or the installation's local analytics only when no backend is configured. A failed connection never falls back to local demo records. Missing/stale data blocks the report. Reports have their own frozen recipient run and resumable preparation, so an interrupted large run cannot lose or repeat recipients. Daily visitor totals are labeled as sums rather than unique people across the entire period.

Report variants use separate saved templates. Digest frequency and timezone are configurable. Optional button measurement uses opaque IDs and includes a scanner limitation. UTM identifiers contain no recipient email. Article-to-newsletter drafts accept reviewed article content and a link; they do not fetch, publish, or send an article automatically. Open pixels, marketing A/B sends, predictive delivery, mailbox ingestion, and complex workflow graphs are deferred.

A trusted `customer.converted` event may supply `campaignId`. Reporting attributes it only when the same contact has a submitted or delivered live message from that campaign within the preceding 30 days. Capture tests and unrelated contacts cannot produce attributed conversions. This match measures association, not causation.

## Budget and recovery

Cloudflare currently includes 3,000 counted outbound emails per paid account monthly, then $0.35 per 1,000. Authentication and appointment mail share that account allowance. Examples: 5,000 counted emails add $0.70; 20,000 add $5.95 above the existing account base. Worker, database, R2, queue, tax, and other account usage are separate. Queue feedback normally uses the included operation allowance at this scale, but measure retries and other queues. Local counters and warnings are estimates rather than a provider billing ceiling. [Email pricing](https://developers.cloudflare.com/email-service/platform/pricing/) · [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/).

Pause sending or an individual campaign to stop new submissions. Already-submitted email cannot be recalled. A known pre-submission rate rejection can retry with backoff; an ambiguous send becomes **Uncertain** and is never automatically resent. Review provider evidence, then close the job or deliberately retry with the displayed duplicate risk. Keep preference endpoints, hostname, native feedback, keys, and suppression records while outstanding links/messages exist.

Contact deletion clears primary personal fields, queued/captured bodies, preference evidence, and personalization snapshots while retaining a protected suppression identity. Detailed provider events and terminal message bodies have a 90-day retention policy; aggregates are retained for 12 months. Export results and restore keys/backups through the business's private operations workflow. Never roll back a live database or erase suppressions to recover sending.

Keep the module registered in the Worker and keep its schedule running when disabling it in the manifest. Its disabled maintenance handler performs retention and lease cleanup without imports, enrollment, or sending. Native feedback and existing opt-out links also retain their narrow handlers.

## Real admin acceptance

Start in capture mode in one intended business admin. Verify existing login, users, forms, records, and all other enabled modules. Import a small reviewed list, save a template and segment, preview a representative recipient, approve a captured campaign, exercise an opt-out during a wait, and inspect the expected receipt/history. Then verify actual Cloudflare resources, sender, quota, native feedback, real Turnstile execution, and email-client rendering using designated test addresses before enabling live sending.

Package/browser tests use synthetic D1/R2 data and simulated mail/challenge/feedback transports. They do not establish live DNS or inbox delivery. npm publication, remote migration, deployment, subscription provisioning, and live recipient tests remain separately authorized operations.
