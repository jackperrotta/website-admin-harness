# Email campaign module implementation plan

Proposed and revised on November 6, 2026. The package implementation is prepared as version 1.6.0. Enabling an installation, provisioning, remote migration, deployment, and recipient sending remain separate operations. Delivery and infrastructure use Cloudflare only. Each business has its own Cloudflare account and installation.

Add an optional `email-campaigns` module for customer communications, reports, newsletter composition, and permitted email campaigns to existing leads and customers. Build the interface, audience records, templates, automation engine, and reporting into each business's existing Cloudflare installation. Cloudflare Email Service is the sole production transport; local development uses capture mode. Initial planning volume is fewer than 5,000 contacts and 20,000 emails per month across the first businesses; actual sending, allowance, and billing are assessed independently per account.

The first release should deliver useful customer reports and transactional website-triggered sequences together with the reusable composition and audience tools. More advanced optimization can follow once real usage establishes a need. Each business retains its own Cloudflare account, Worker, D1 database, R2 bucket, email sender, hostname, users, contacts, preferences, and reporting. The shared harness is reusable package code; Vitris does not host the other businesses' records or delivery.

## Cloudflare delivery scope and budget

Cloudflare Email Service currently supports transactional email only. Its terms tie that use to a specific customer interaction and an agreed transaction or customer update. A report about an agreed service is a stronger candidate than a general newsletter or sales sequence. These are design classifications, not confirmation that every report or subscribed publication is permitted. Message purpose and content govern eligibility; subscription, an existing customer relationship, or the label newsletter/campaign does not automatically make promotional mail transactional. See [Cloudflare's explicit marketing FAQ](https://developers.cloudflare.com/email-service/reference/faq/#can-i-use-email-service-for-marketing-emails) and [Email Service terms](https://www.cloudflare.com/service-specific-terms-developer-platform/#cloudflare-email-service).

Use a dedicated, sender-restricted `CAMPAIGN_EMAIL` Cloudflare structured send binding for the module. Preserve `AUTH_EMAIL` and `SCHEDULING_EMAIL` and their current operations. Keep newsletters and campaign layouts available for drafting and preview; activate delivery only for purposes that fit Cloudflare's supported use. Promotional newsletters, upsell campaigns, and sales nurture remain outside this release's sending scope. Ambiguous editorial newsletter use needs specific confirmation from Cloudflare before live sending. Do not add another provider, automatic fallback, or a generic transactional checkbox that bypasses this boundary.

Budget each business against its own existing Workers Paid account, starting at $5 per month, and its own combined website/admin workload. The plan includes 10 million Worker requests and 30 million CPU milliseconds monthly. Do not combine allowances, quotas, costs, or credentials across businesses. At the planned volume, keeping additional compute and database charges near zero is a reasonable engineering target, subject to measuring each account's usage. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Email Sending currently includes 3,000 outbound emails per account per month on Workers Paid, then $0.35 per 1,000. The allowance is shared with other counted Email Sending in that same account, including authentication and appointment mail. Sends to verified destination addresses are documented separately as free; do not assume ordinary subscribers are verified account destinations. See [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

| Counted outbound emails in one business account per month | Estimated Email Sending overage | Account base plus email overage |
| --- | --- | --- |
| 3,000 | $0.00 | $5.00 |
| 5,000 | $0.70 | $5.70 |
| 20,000 | $5.95 | $10.95 |

The calculation is `max(0, counted account emails - 3000) / 1000 * $0.35`. These examples assume other services remain within included allowances and exclude taxes and other usage. Incremental cost above an already-paid $5 account can therefore be zero at small volumes, but $5 is not an unlimited email plan. Apply the calculation separately to each business's actual volume; the current 20,000-email planning ceiling is across businesses, not a committed volume for every account. Contact count alone should incur no harness subscription fee.

Daily sending limits are separate from monthly billing allowances. Cloudflare starts accounts conservatively and adjusts limits based on sending behavior and reputation. Check each business's actual quota, sender/domain onboarding, and account availability before enabling sends; a $5 subscription alone is not evidence of production capacity. See [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/). Keep existing mailboxes and MX records; do not introduce mailbox hosting or runtime AI as a dependency.

## Product experience

Add **Email campaigns** under the existing Business tools navigation. Keep Overview, Leads, Analytics, Settings, Users and access, and Activity intact. Inside the module, provide Summary, Campaigns, Contacts, Segments, Templates, Automations, and Email settings. Show a permission-checked Overview summary for scheduled campaigns, automation health, and problems requiring attention.

The main flow is: choose a supported communication purpose and template, write the content, choose the eligible audience, preview representative recipients, send an explicitly addressed test, review the final audience count and account-specific cost estimate, then send or schedule. The send action names the business, sender, campaign revision, purpose, and audience count. Captures, drafts awaiting purpose confirmation, tests, and production are visually distinct. A missing or unsupported purpose blocks live submission while preserving the draft.

### Contacts and segmentation

- Create contacts manually, through reviewed CSV imports, or through approved website connections. Import mapping, preview, validation errors, duplicate handling, source attribution, and an import receipt are part of the first release. Export contacts, preferences, suppressions, campaign results, and template content in portable formats.
- Store name, email, company, optional role, relationship stage, owner, tags, source, dates, and a small typed set of custom fields. A contact may link to multiple enquiries; do not duplicate or replace authoritative lead history. Keep email normalization conservative and preserve the original value; do not strip plus addressing or Gmail dots.
- Separate contact existence, relationship stage, optional topic subscription, communication purpose, delivery suppression, and automation enrollment. Optional-report preferences do not disable account security or necessary appointment messages.
- Record permission and purpose evidence by business and topic: source, time, wording/version, associated customer interaction or agreed service, and confirmation where applicable. CSV import never clears an existing unsubscribe, complaint, or bounce suppression. Avoid importing freeform lead notes or sensitive form contents into communication records. Subscription evidence is distinct from Cloudflare transport eligibility.
- Support preference topics for reports and permitted customer updates. Retain newsletter subscription records for composition and future confirmed permitted use, without enabling newsletter delivery by subscription alone. Preferences for one business never subscribe a person to another business.
- Save segments using bounded AND/OR rules over tags, fields, stage, subscription, source, and explicit website/conversion events. Include exclusions, readable rule summaries, real server-side counts, and a sample preview. Initial rules should favor explicit state and conversions over unreliable email opens.
- Evaluate broadcast segments when the send is approved and freeze the resulting recipient set. Before every individual submission, recheck subscription, suppressions, current address, frequency limits, campaign state, and relevant conversion exits. Eligibility can shrink a queued audience; it cannot silently add recipients after approval.

### Templates and composition

Provide starter layouts for a personal response, a periodic customer report, a service/status update, and a newsletter draft with several stories. Configure each business's logo, colors, sender name, reply address, physical mailing address where applicable, and required footer once. Layouts do not establish sending eligibility; a service-update layout containing an upsell remains promotional.

Use trusted, versioned email templates with structured content fields and constrained formatting for headings, paragraphs, images, links, buttons, and reusable sections. Add duplication and explicit section ordering controls. This fits the repository's prohibition on a drag-and-drop builder and arbitrary HTML editing. Agents can develop additional trusted layouts through source changes; runtime must not execute prompts, scripts, or imported template code.

Include subject and preheader, plain-text output, responsive email HTML, dark-mode and image-off checks, image alt text, supported personalization with fallbacks, safe links, mobile/desktop previews, sample-contact previews, test sends, and template version history. Block missing required values and broken required links before approval. Freeze the template, content, and personalization snapshot for an approved revision. Use a separately authorized agent workflow for optional writing assistance.

Previewing email HTML requires a narrowly scoped sandboxed document response. The current special CSP handling covers scheduling previews only; add an explicit campaign-preview policy without loosening the main application CSP. Scope R2 image uploads to the campaign composer; publish only approved image assets through a dedicated read-only asset path. Imported CSVs, exports, recipient data, and personalized previews stay private. Do not introduce Pages or Media sections.

### Campaign operations

Support drafts, duplication, revision history, immediate or future sending, a business timezone, pause/resume/cancel, recipient exclusions, and clear per-recipient outcomes. Store actual scheduled instants in UTC and explain the selected timezone and daylight-saving behavior. Sending proceeds gradually; a scheduled time is a start time rather than an inbox-delivery promise. Follow with a campaign calendar and optional nonpersonalized browser versions of approved newsletter issues; publication is explicit and never exposes recipient previews or introduces a page builder.

Recurring newsletter schedules should create a new issue draft and reminder. Newsletter transmission remains unavailable until its particular use is confirmed permitted. Recurring customer-report delivery can run automatically for an agreed service, using a trusted report definition, eligible recipients, purpose-specific settings, and fresh report data for each period. Missing data or a failed report generator blocks that report instead of sending an old issue or empty attachment.

Distinguish queued, captured, submitted, delivered to receiving server, bounced, complained, suppressed, blocked, failed, and uncertain. Provider acceptance is not inbox delivery. An email already submitted cannot be recalled when a campaign is paused.

### Website automations

Start with a guided sequence editor: one trigger, conditions, send, wait, branch, update tag/stage, create a staff follow-up task, and exit. Present an understandable step list rather than a general visual workflow engine. Bound the steps, waits, branching, re-entry, and lifetime; exclude arbitrary code and loops.

Initial triggers are a relevant customer interaction, a due report for an agreed service, a trusted service/status change, and manual enrollment with a supported purpose. Newsletter signup records preferences but does not authorize promotional sending. Add trusted booking and customer-status events only when their owning modules expose production-ready contracts. Event types such as `lead.created`, `report.ready`, `subscription.confirmed`, and `appointment.booked` are proposals, not existing cross-module guarantees. Tags and manual enrollment cannot manufacture an agreed service or bypass a purpose restriction.

Useful initial recipes:

| Business use | Example sequence | Exit condition |
| --- | --- | --- |
| Vitris customer reporting | Due report under the customer's agreed service; generate current analytics/status data; send to authorized recipients | Service ends, recipient authority changes, optional-report opt-out, or suppression |
| Website enquiry handling | Enquiry received; acknowledgment or requested information; staff task for the response | Enquiry resolved, staff stop, or invalid contact |
| Chairside customer updates | Agreed service milestone changes; send the relevant status or requested report | Service completed, recipient changes, staff stop, or suppression |
| Jack Perrotta newsletter | Confirmed signup record; create a monthly or biweekly issue draft and preview | Delivery remains unavailable until this newsletter use is confirmed permitted |

Recipes must preserve the relationship to the specific interaction or agreed service. A form submission can support a relevant acknowledgment or requested response; it does not authorize an automated sales sequence. Promotional case-study follow-ups, upselling, and re-engagement sending are excluded from the Cloudflare-only release. Customer report generation must use a scoped read grant and an explicit report definition, never unrestricted contact or analytics export.

Recheck eligibility and exit conditions after every wait and immediately before sending. Pin published automation versions for active enrollments. Editing a published sequence creates a new version; changing existing enrollments requires a deliberate operation. Pause/resume must state how overdue steps are handled, skip stale messages, and avoid a catch-up burst.

Provide staff stop and reply-recorded actions initially, with stop-on-reply performed manually. Deliver replies to the business's real monitored mailbox. Cloudflare's outbound lifecycle events do not include inbound replies. Automatic reply handling would need a separately reviewed Cloudflare Email Routing flow that preserves existing mailbox/DNS arrangements; no external mailbox connector is planned. Expose the manual-stop limit instead of promising automatic stop-on-reply.

### Reporting and optimization

First-release reporting should show audience size, eligible/excluded counts and reasons, submitted/delivered/bounced/complained/unsubscribed counts, campaign links, conversions, automation enrollment and completion, and the recipient timeline. Define the denominator and time window for every rate.

Use campaign identifiers and UTM parameters to connect clicks to website enquiries or bookings through an explicitly agreed event contract. Label attribution windows and limitations; aggregated anonymous analytics cannot automatically identify a subscriber or prove a sale. Only trusted server events should terminate a sequence as converted. Treat link scanners and automated clicks separately from confirmed website actions.

Make open pixels optional and disabled initially. Opens are an estimate affected by privacy tools and image loading; clicks can also be automated. Neither should determine essential workflow actions. Keep recipient addresses out of URLs and logs, use opaque tracking identifiers, validate redirect targets, and avoid public per-recipient archives.

Follow with report variants, recipient timezone delivery, configurable digest frequency for eligible updates, and optional verified-click reporting. Newsletter issue drafts and article-to-newsletter composition remain useful without enabling transmission. Marketing A/B sends and re-engagement campaigns are deferred unless Cloudflare's supported scope changes; no alternative transport is planned. At small audience sizes, any future permitted test must show counts and uncertainty instead of declaring an unsupported winner.

## Cloudflare implementation

### Existing foundations and required extensions

The repository already provides trusted `AdminModule` handlers, explicit manifest enablement, server-side permissions, exact POST hooks, optional scheduled handlers, D1, R2, and compiled React module interfaces. The scheduling and account outboxes provide useful lease, capture, and uncertain-send patterns. They are transactional implementations, not a campaign engine to reuse directly.

| Area | Proposed change |
| --- | --- |
| Contracts | Add `packages/contracts/src/email-campaigns.ts` with validated settings, supported communication purposes, DTOs, segment grammar, permission names, bounded events, and native send outcomes. Extend trusted queue dispatch for lifecycle events. Export through existing contracts. |
| Runtime | Add `packages/admin/src/email-campaigns/` for module routes, contacts, imports, consent, segments, templates, sending, feedback, automation, public preference operations, and reporting. |
| Optional export | Add a separately registered `/email-campaigns` runtime export and type declarations, following the optional billing export pattern. Import into both intended Worker entry points and explicitly enable the module in each intended manifest. |
| UI | Add a lazy-loaded `packages/admin/ui/src/email-campaigns/` workspace, module label/icon, template preview handling, and permission-checked Overview integration. |
| Migrations | Add reviewed numbered module migrations under `packages/admin/modules/email-campaigns/migrations/`, following optional-module packaging. Finalize numbering and installation tooling when implementation begins; never edit existing migrations or create tables at runtime. |
| CLI and guidance | Add an email connection plan/apply workflow, readiness diagnostics, migration/setup documentation, sender checks, capture mode, recovery instructions, and exact compatibility pins. |
| Website harness | Propose a separate reviewed change in the website repository for subscription forms, consent evidence, signed event delivery, and conversions. Preserve existing form configuration, destinations, backend grants, and origins. |

### Records and execution

Model contacts, topic subscriptions and evidence, tags/fields, segment definitions, template revisions, campaigns, recipient snapshots, send jobs, provider events, suppressions, automation versions/enrollments/steps, event receipts, and import jobs. Every business query constrains `manifest.site.id`; jobs and externally delivered events also bind the installation identity. Index email identity, due jobs, campaign recipients, event deduplication keys, segment predicates, and provider message IDs. Keep operational events append-only where needed and retain compact daily aggregates.

For outbound scheduling at the initial scale, use indexed D1 due jobs and the existing one-minute Worker cron. Build audience snapshots and imports incrementally with resumable cursors and unique keys, so interrupted runs resume without duplicating jobs. Do not send campaigns synchronously in an HTTP request or rely on an in-memory timer or long sleep. Separately, use an account-owned Cloudflare Queue for native Email Sending lifecycle feedback; this queue is part of the initial live-delivery setup, not an optional external service.

Bound each scheduler run by job count, elapsed time, provider quota, and installation budget. Prioritize account and appointment operations and isolate task errors so an unavailable calendar or billing extension cannot indefinitely starve campaigns. The current scheduler awaits services sequentially, so implementing and testing this isolation is an explicit runtime change. Campaign failures must likewise leave account mail and scheduling operational. Preserve the returned `scheduled` handler in wrappers; Pages installations require an explicit private Worker strategy because Pages does not run Worker cron.

Start with an illustrative limit of 100 submissions per minute, capped further by the business account's actual daily/rate limits and reserved capacity for account/appointment mail. A permitted 5,000-recipient run would then take about 50 minutes if the account quota allows it, plus retries and delays. Validate this target rather than assuming capacity. If faster outbound processing is required, add sending jobs to Cloudflare Queues after measuring throughput. Queue redelivery still uses D1 identities and leases and never establishes exactly-once email delivery. Do not add Durable Objects, Workflows, KV, or a second database without a measured need.

The D1 send identity must uniquely bind business, campaign revision or enrollment step, purpose, and recipient. Claim work atomically with a lease. A pre-submission failure known to be safe can retry with bounded backoff; an ambiguous transport outcome becomes uncertain. Cloudflare email acceptance can occur before a process crashes, and D1 cannot atomically commit with the send service. Do not promise exactly-once delivery or automatically resend unknown submissions. Reconcile with lifecycle events and expose a deliberate resolution action. Feedback may arrive before local acceptance is recorded; retain and reconcile it by job/message identity.

Apply durable rate and frequency reservations across optional customer communications and automations. Include per-contact frequency limits, minimum spacing, account-aware daily/monthly send limits, a recipient cap, and reserved quota for essential account/appointment messages. Preview estimated completion time and per-account cost before approval. Budget warnings and a local stop switch reduce accidental usage but are not a guaranteed billing ceiling. Optional reports must not crowd out password recovery or other essential transactional mail.

### Website events and public endpoints

Ordinary management routes stay under `/api/modules/email-campaigns/` with existing session, Origin, host, module-enable, and per-action permission checks. Use exact registered POST hooks for signed website events with independent machine authentication. Native delivery feedback arrives through the account-owned Queue rather than an unauthenticated public webhook.

The existing extension contract does not supply general public GET or customer preference routes. Add a small typed registration for exact public email paths with explicitly allowed methods and purpose-specific authentication. Never exempt the whole module namespace from session/Origin checks. Proposed operations include signup/confirmation, preferences, visible unsubscribe, RFC 8058 one-click unsubscribe, and optional click redirects. Public forms enforce exact website origin, bounded input, rate limits, and real Turnstile where appropriate. Add exact-origin CORS and preflight handling for cross-origin website forms without sharing admin session credentials. Origin alone is not authentication; successful signup must never allow the caller to subscribe an arbitrary third party without confirmation.

Signed website events contain an allowlisted type, event ID, business/installation, source identity, timestamp, and minimal payload. Use scoped secret rotation, signature verification, replay controls, durable deduplication, and versioned schemas. The website backend records a durable event/outbox entry and retries independently so a campaign failure never loses or rolls back the original enquiry. Reconciliation imports must be explicit and must not trigger historical nurture enrollments automatically. Test records and events remain isolated and cannot enroll real contacts.

Configure a Cloudflare Email Sending event subscription for this installation's verified sending domain, targeting its own Cloudflare Queue. Verify expected account, zone, domain, subscription, event schema, and known message/recipient identity before storing an event. Deduplicate event IDs, handle reordered events, acknowledge only after durable processing, and use a dead-letter/recovery path. Cloudflare publishes delivery, bounce, complaint, and other lifecycle events; confirmed server acceptance is distinct from inbox placement. See [Cloudflare Email Sending event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/).

Extend the current trusted module/runtime contract with bounded queue dispatch, exact queue-name registration, and installation checks; preserve the returned `queue` handler alongside `scheduled` in Worker wrappers. Pages installations need that explicit account-owned private Worker consumer. A queue consumer cannot accept arbitrary module IDs from a payload. Keep the consumer's narrow suppression/feedback processing active for already-submitted messages when campaign sending is disabled.

Queues currently includes one million operations per account monthly on Workers Paid, then $0.40 per million; a normal small message delivery uses about three operations before retries. Lifecycle events are separate messages and other queues share the allowance. Include observed feedback volume and retries in each business's cost/readiness view. See [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

Keep issued unsubscribe links working when sending is paused or the module is disabled. Implement that as a narrow, installation-owned suppression service outside the normal enabled-module gate; it grants no campaign read or send authority. Feedback intake needed to suppress already-submitted mail should also remain active while the installation retains outstanding messages. Disabled-module tests must distinguish these purpose-limited endpoints from disabled administration and delivery. Preserve the hostname/service for outstanding opt-outs when retiring an installation.

### Permissions and sensitive data

Proposed permissions are `email-campaigns:read`, `email-reports:read`, `email-contacts:read`, `email-contacts:write`, `email-contacts:export`, `email-content:write`, `email-campaigns:send`, `email-automations:manage`, and `email-settings:manage`. Aggregate reporting authority never grants individual contact details or recipient timelines. An automation that creates core Work queue tasks also requires a reviewed `tasks:write` grant when published; cross-module actions cannot borrow an unrelated email permission.

Owners receive the module permissions. Initially leave other roles without automatic send, export, automation-publish, or provider-setup authority; define and test explicit grants through the existing role/access model. The current administrator mapping grants new permissions unless excluded, so update that filter deliberately. Existing Leads, Activity, Analytics, Webmaster, or cross-installation sign-on access must not implicitly grant campaign access.

Use a native `CAMPAIGN_EMAIL` binding restricted to this business's approved sender and its own Cloudflare resources. Protect deployment/API credentials in the existing secret workflow; do not introduce runtime credentials for an external email service. Keep the binding and configuration separate from `AUTH_EMAIL`, `SCHEDULING_EMAIL`, and existing backend grants. Encrypt sensitive queued personalization and private action tokens with an installation-owned key ring. Keep raw contacts, imports, exports, bodies, tokens, and lifecycle payloads out of public archives and routine logs. Audit actor, operation, revision, counts, and identifiers rather than email contents.

Define retention at implementation time with a proposed starting policy of 90 days for detailed engagement events and 12 months for aggregates, with configurable contact deletion/export. Deletion must retain the minimum protected suppression identifier needed to avoid reimporting an opted-out address. Encrypt backups/exports and document key recovery; a suppression hash that can be checked must be keyed and treated as sensitive data.

## Deliverability and subscription controls

Before production, verify the business account, supported communication purposes, sender-domain onboarding, DKIM, SPF, DMARC alignment, monitored Reply-To, native feedback delivery, available quota, and the physical postal address where applicable. Preserve existing mailbox MX records and existing authentication-mail configuration. A sending subdomain separates operational configuration but does not guarantee reputation isolation from the parent domain.

Optional subscribed customer reports and updates include clear preferences and opt-out controls, with one-click unsubscribe headers where applicable. Implement token-authorized POST opt-out without login, CAPTCHA, or confirmation. A visible GET link opens a simple preference page; GET alone must not change preferences when scanned. Apply opt-out immediately to queued optional sends; resubscription requires a new verified action and never clears complaint or hard-bounce suppression automatically. Necessary account security and appointment messages remain in their separate existing channels. Unsubscribe support does not make promotional sending permitted. Retain the applicable [Gmail sender guidelines](https://support.google.com/a/answer/81126?hl=en) and [FTC commercial email guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) for content review.

Handle hard bounces and complaints with immediate suppression; handle transient deferrals using bounded provider-aware rules. Add feedback freshness monitoring, backlog alerts, and an automatic campaign pause for unhealthy delivery or missing suppression feedback. Pilot thresholds should be conservative and include a minimum sample size, immediate complaint review, and manual recovery; do not present a generic percentage as a universal provider allowance.

New optional website subscriptions use double opt-in by default. Import existing permission/purpose evidence rather than assuming every lead/customer subscribed. Purchased lists, unsolicited outreach, and promotional nurture sending are outside this Cloudflare-only scope. Newsletter drafting and preference collection remain available, with transmission awaiting confirmation of permitted use. Future expansion must remain within Cloudflare's then-current supported scope; the plan contains no fallback provider.

## Delivery phases and acceptance

### Phase 1 Foundation and captured campaigns

Implement contracts, optional-module registration, permissions, additive schema, contacts/imports, subscription/suppression records, segment previews, structured templates, private previews, and a durable capture outbox. Include the public preference route contract early because safe sending depends on it. Provide synthetic Vitris-style, service-business, and personal-newsletter fixtures without customer data.

Acceptance: imports are resumable and cannot restore an opt-out; segment counts cover all eligible records; preview output has the required footer and fallbacks; conflicting edits return a revision conflict; disabled and unauthorized modules expose no administration or sending. No capture can become production mail merely by changing a setting.

### Phase 2 Complete the first useful release

Add the native Cloudflare structured sender, account-owned feedback Queue/subscription, verified sender and purpose readiness, gradual sending, frequency controls, unsubscribe/preferences, lifecycle reporting, guided transactional automations, a fresh-data customer-report recipe, and one real website event integration. Include stop-on-resolution and manual stop/reply handling. Build this as test/capture mode first, then prepare the concrete business installation diff. General newsletter drafts remain distinct from live-enabled communication purposes.

Acceptance: a supported website interaction starts the correct transactional sequence; a due agreed-service report uses fresh data and authorized recipients; duplicate events create one enrollment; optional-topic opt-out cancels corresponding future sends without disabling essential mail; resolution stops the relevant sequence; overlapping cron runs do not duplicate claimed jobs; unknown send outcomes are never blindly retried. A supported-purpose 5,000-recipient fixture completes within the measured throughput target and configured quota while ordinary admin and authentication remain responsive. Newsletter signup or renaming a sales draft must not enable unsupported sending.

Phase 2 is the first proposed production-capable release for customer reporting and supported transactional workflows. Sales nurturing and general newsletter transmission are not promised under the current Cloudflare-only sending constraint.

### Phase 3 Reuse and optimization

Pilot one business account with a small permitted customer-report or service-update run, then roll out the package independently in the other businesses' accounts. Add report variants, digest frequencies, optional click measurement, article-to-newsletter drafts, further explicit website/module events, and optional outbound queue processing as needed. Native feedback already uses a Queue in Phase 2. Template code/brand presets can be portable; contacts, users, permissions, resource bindings, allowances, and sending identities stay within each business's account.

Automatic reply synchronization, predictive send-time optimization, complex visual workflow graphs, SMS, ecommerce carts, a standalone CRM, and full hosted mailbox service remain later projects. None is required to cover the initial uses.

### Verification and release gates

1. Run `npm run check`. Add focused tests for disabled modules, role/grant revocation, cross-site IDs, exact origins, public-route token scopes, invalid/oversized input, malicious template values and CSV formulas, signed webhook spoofing/replay, and recipient-data leakage.
2. Exercise suppression during snapshotting, claimed and delayed jobs, permission withdrawal, imports after deletion/opt-out, duplicate/out-of-order native feedback, wrong-account/zone/domain events, queue retries/dead letters, automation versioning, timezone/DST behavior, quota throttling, scheduler overlap, lease expiry, send acceptance followed by a crash, missing feedback, and site/event test-mode isolation. Test unsupported communication purposes and per-account allowance calculations explicitly.
3. Migrate a fixture at the previous supported schema; verify existing users, sessions, Leads, Scheduling, Billing, origins, forms, and account mail. Test missing campaign migrations as a module readiness error without breaking core admin.
4. Verify desktop/mobile, keyboard access, empty/error/loading/conflict states, and email rendering in representative Gmail, Outlook, and Apple Mail clients using designated test mailboxes. Local browser previews alone do not prove email-client rendering or inbox delivery.
5. Pack runtime, contracts, and initializer and install exact archives outside both workspaces. Repeat captured website signup, sequence, feedback, and unsubscribe flows without sibling source imports. Required integration tests must fail rather than silently skip missing dependencies.
6. Author package-specific `docs/releases/<version>.json`, README changes and substantive release notes; verify packed privacy, manifests, declarations and migration inclusion. Keep release credentials outside source and archives. Package publication and documentation follow the existing release receipt/retry workflow; never republish an existing npm version.
7. For each separately authorized rollout, review that business's exact Cloudflare account/installation/resources, backups, schema, permissions, email costs, DNS, secrets, origins, schedule/queue forwarding, feedback, quotas and recovery. Publish/deploy/migrate only the authorized target. A website connection does not silently enable collection, subscribe contacts, enable newsletter sending, send mail, or upgrade a shared backend.

Recovery pauses new optional communications and automations, retains public opt-outs and native feedback processing, drains or supersedes known jobs deliberately, and preserves uncertain jobs for reconciliation. Disable module submission without disabling existing account/appointment mail; never roll back D1 or erase suppressions to recover delivery. Record the deployed package/schema revisions and verify existing authentication and business operations after rollout.

## Decisions before implementation

The audience and scale remain existing leads/customers, fewer than 5,000 contacts and 20,000 messages monthly across the first businesses. The architecture is Cloudflare only: each business's own account, Worker, D1, R2, restricted Email Service binding, and native lifecycle-feedback Queue. Use D1 plus cron for initial outbound scheduling, guided transactional sequences, and per-business preference/purpose isolation. Budget against each account's own $5 base and 3,000-email allowance with metered overage.

Implementation planning needs an inventory of each installation's actual Cloudflare account/platform, sender domain, schema/package version, available customer-interaction/service evidence, website event capabilities, existing counted email volume, and daily sending quota. Select a customer-report or service-update pilot based on that readiness. General newsletter sending remains unresolved pending confirmation from Cloudflare for the specific content and subscription model; no substitute service will be introduced. Prepare concrete account-specific installation changes before any separately authorized provisioning or recipient mail.


## Implementation handoff

Version 1.6.0 implements the foundation, supported sending/workflows/reporting, and reusable optimization features from phases 1–3. The source includes the optional module, compiled desktop/mobile UI, typed server/browser SDKs, additive admin and website outbox migrations, account-specific setup plan/apply command, and package-specific release notes. No business installation is enabled by updating the packages.

The implementation uses D1/cron outbound work and native Queue feedback. Additional outbound queue processing remains unnecessary at the initial scale. Newsletter transmission, predictive optimization, complex workflow graphs and automatic mailbox reply synchronization remain outside scope as described above.

The synthetic 5,000-contact capture fixture completed 5,000 recipients without duplicates in 101 scheduler ticks (about 103 minutes of simulated schedule time at the bounded runner pace). Concurrent authenticated admin requests succeeded. This measures local D1/R2/capture behavior; it does not measure Cloudflare inbox placement or production quota. Repeat with `npm run email:load-test`; evidence is written to `artifacts/email-campaigns/load-test.json`.

The real business pilot and rollout remain the external acceptance portion of phases 2–3. Follow `docs/EMAIL-CAMPAIGNS.md` using one exact business account first. Verify DNS, native event subscription, real Turnstile, account quota, designated mailbox rendering and actual delivery before enabling Send. Publication and remote operations have not been performed by this implementation task.


### Verified release candidate

- `npm run check`: 255 tests passed, zero failures/skips, including existing account, scheduling, billing, connection and browser suites.
- Final rebuilt email-specific regression suite: 24 passed; release-documentation tests also passed. Final TypeScript and publication privacy checks passed.
- `npm run release:verify-packed`: passed against the exact 1.6.0 archives installed outside the workspace. It checks public SDK declarations, isolated campaign/signup/confirmation/sequence/feedback/opt-out flows, setup plan/apply preservation and stale-plan refusal, Wrangler dry run, and exact embedded package README contents.
- The repeated synthetic load run captured 5,000 recipients with no duplicates in 101 ticks. The runner used simulated schedule time (about 103 minutes); observed local execution took about 82 seconds. Concurrent authenticated admin response samples ranged from 7 to 1,170 ms. These are local fixture results, not production latency or delivery guarantees.
- Desktop/mobile screenshots are in `artifacts/email-campaigns/`; final archives and integrity manifest are in `artifacts/releases/1.6.0/`. The package manifests include distinct package-specific release notes.

No npm publication, customer deployment, remote migration, native subscription provisioning or real recipient sending was performed. The real-account acceptance checklist in the module guide remains the next operational stage.
