# Vitruous client management admin plan

Create a dedicated Vitruous admin installation with an optional `client-portfolio` module for managing clients, their websites, and their analytics. A client can have several websites. Each website keeps its existing backend, admin installation, users, records, and hostname. Other admin variants continue to use their own selected modules.

This is a proposed implementation plan. Jack is the only initial user, with team access possible later. The first release includes client tracking, analytics, initiating website updates, reviewing previews, and publishing approved changes. Client lead management and client logins remain later additions.

## Product experience

Keep the core Overview, Leads, Analytics, Settings, Users and access, and Activity navigation. Add **Clients** under the existing business tools area only when `client-portfolio` is registered, enabled, and authorized. Its internal views are:

| View | What Jack can do |
| --- | --- |
| Portfolio | See connected websites, traffic and enquiry trends, sites needing attention, and how many sites contributed to each total. Filter by client, website, and reporting window. |
| Clients | Search clients, view their contact details and status, and see all websites belonging to each client. |
| Website workspace | Inspect one website's analytics, connection status, internal notes, and follow-up tasks; request a website update; review its preview; publish an approved revision; open its public website or existing admin. |
| Website changes | Track requested changes, agent handoff, execution, previews, release checks, publication, and failures across clients. |
| Connections | See whether access is configured, verified, stale, unavailable, or revoked, with the last successful check and a clear next action. |

The first useful flow is: open Clients, inspect a website's analytics, request a change in plain language, review the resulting preview and checks, and publish that revision. Include empty, loading, partial-success, error, and archived states on desktop and mobile. A connection error can become a follow-up without starting a website change.

Core Overview and Analytics continue to describe the Vitruous installation's own website. Portfolio totals and client analytics remain within Clients so their meaning is clear. Entering a website workspace changes the module's selected website; it never rewrites the installation manifest or changes the meaning of existing core APIs.

## Extension and installation boundaries

Use the existing trusted build-time `AdminModule` mechanism. Register `client-portfolio` in the Vitruous installation's production and local Worker entry points and explicitly enable it in the intended manifests. Compile a dedicated React interface using the existing optional-module UI pattern. Runtime remote scripts are outside this design.

Keep reusable module source, contracts, migrations, and synthetic fixtures in the harness; keep the actual Vitruous installation, client registry contents, connection configuration, and credentials private. Initializers and existing manifests must leave this module disabled. Other installations must not need its resource bindings or execute its queries or network requests.

The existing connection consists of one `manifest.backend` and one `HARNESS_API_TOKEN`. Preserve that contract for ordinary admins. Add a separate module connection registry rather than converting the core manifest to a multi-client model. The module's outbound adapter can reuse validated request and response helpers after those helpers accept an explicit connection identity and credential without shared mutable state.

Use Cloudflare Workers and D1 in the dedicated Vitruous installation. Existing Cloudflare Email Service handles its authentication. A separately paired local operator bridge runs website tooling using Jack's configured environment; the Worker stores structured jobs and status rather than running an agent or shell. Initially the bridge can poll for work while connected, so no hosted queue, cron trigger, or extra paid service is required. Use each website's existing preview/artifact storage; add an R2 workflow only if private artifact sharing requires it.

## Records and permissions

All module queries must constrain the owning installation's `manifest.site.id`. A managed website is a child record within that scope, not a replacement for it. Use composite keys and relationships to prevent a client, connection, or cached metric from belonging to a different scope.

| Record | Initial fields and behavior |
| --- | --- |
| Client | ID, owner site ID, name, optional contact details, status, notes, timestamps, revision. |
| Managed website | ID, owner site ID, client ID, name, exact public and optional admin origins, status, timestamps, revision. One client can own multiple website records. |
| Connection metadata | Website ID, provider and verified remote identity, credential reference, last success, last attempt, sanitized error category, configuration revision. Store no plaintext credential in D1. |
| Analytics cache | Owner site ID, website ID, connection revision, metric contract version, reporting window, timezone, bounded validated daily aggregates, source generation time when supplied, fetch time, expiry. |
| Follow-up | Client ID, optional website ID, title, status, due date, timestamps, revision. Keep this module's records separate from the core work queue unless a later reviewed integration adds explicit links. |
| Module access | Active user ID, owner site ID, allowed websites or explicit all-websites grant, and allowed module capabilities. |
| Website change | Website ID, request text, base revision, job state, runner lease, idempotency key, candidate identity, preview reference, actual verification results, approval identity, deployment receipt, timestamps, revision. Store only bounded sanitized logs. |

Add explicit capabilities such as `clients:read`, `clients:write`, `client-analytics:read`, `client-connections:manage`, `client-changes:request`, and `client-releases:publish` to the contracts with tested role mappings. Use `clients:read` as the module entry permission; each endpoint also checks its action capability and website access. An existing core analytics permission must not grant access to every client website. Start with the installation owner explicitly granted all websites and these actions; other accounts receive no module grant by default. Future team grants can allow preparing changes without allowing production publication.

Filter lists, portfolio aggregates, search, cache reads, and connection status by authorized websites before computing results. Recheck active account and current module grants on each request. Writes use server-side validation, exact Origin checks, bounded input, and revision conflict detection. Audit client changes, access changes, connection verification and revocation, and follow-up changes without logging secrets or raw analytics payloads.

Add module schema through a new numbered additive migration selected at implementation time. Preserve existing migration files and existing records. An ordinary installation's upgrade may create empty tables but must not enable module behavior or copy customer data.

## Connecting client websites

Connect to each website's authoritative backend through a dedicated analytics-only grant for the Vitruous installation. Pin the remote tenant, exact website origin, backend origin, contract version, and connecting installation identity. Obtain a new credential per website; do not reuse another admin's credential or deployment token. A separate connection can coexist with the business's own admin grant.

For the initial release, keep the active connection allowlist in private installation configuration and credentials in individually named Worker secret bindings. The dashboard edits client metadata and requests verification; activating or changing a backend origin or credential remains a reviewed installation change. This avoids building a secret vault or allowing browser-supplied URLs to become authenticated fetch destinations. Public bootstrap responses must not expose the private registry or credentials.

Carry forward the adapter's identity checks, redirect refusal, bounded responses, timeouts, and explicit failures. Production connections must reject loopback, private-network destinations, and unapproved origins; local tests use isolated synthetic services. Browser requests identify a managed website record, and the server resolves its approved connection. A connection cannot be redirected by changing a client label or public website link.

Onboarding is per website: inventory the existing collection and API support, review the exact identities and scope, prepare the additional hashed grant, merge it into the complete owning backend grant map, upload the matching secret, and verify status plus analytics. Preserve existing forms, backend URLs, grants, users, and notification delivery. Websites lacking collection show **Analytics not configured**; they require a separate collection setup and have no invented history. Older backends may require a separately authorized upgrade.

Removing or revoking a connection disables reads, invalidates its cache, and provides instructions to revoke the remote grant and remove its Worker secret. The module does not retain visible analytics from revoked connections. Archiving a client or website preserves its management history while excluding it from active portfolio totals; it does not delete or modify the remote installation.

## Analytics behavior

Reuse the existing daily analytics contract and rendering calculations for individual sites. Initially offer the supported 14-day and 30-day windows. Show page views, site-reported visitors, sessions, enquiries, conversion actions, engagement, referrers, paths, channels, and devices when the backend supplies them. Missing optional metrics remain unavailable rather than becoming zero.

Sum additive counts only across compatible reporting windows and metric definitions. Label summed visitors as site-reported visitor counts because people cannot be deduplicated across websites. Compute rates from summed numerators and denominators, and duration from its supported numerator and count; never average site percentages. Keep enquiries distinct from other conversion actions.

A comparison uses the same contributing websites and matching current and prior windows. Display the coverage and source timezone. For the initial portfolio, combine daily series only when reporting boundaries match; show other timezone groups separately until a backend contract supports a common reporting timezone. Exclude test and preview traffic using the authoritative backend's production contract.

Start with a short D1 cache, for example five minutes, and bounded concurrent refreshes. Return successful sites even if another site fails. Display each site's last successful fetch, data generation time when known, and freshness. Clearly mark any retained stale data and exclude it from fresh totals; show unavailable sites as missing coverage. A manual refresh obeys server limits and coalesces duplicate work. Add scheduled refresh only if real usage requires it, with an explicit binding and schedule review.

## API outline

Place all routes below `/api/modules/client-portfolio`, using the existing host, session, enablement, baseline permission, and CSRF gates. The following route families add finer action and website checks:

- `GET /portfolio` returns authorized portfolio metrics, coverage, freshness, and connection summaries.
- `GET /clients` and `GET /clients/:id` return scoped client records; create/update routes require `clients:write`.
- `GET /websites/:id` and `GET /websites/:id/analytics` return one authorized workspace and its validated analytics.
- `POST /websites/:id/connection/verify` requires `client-connections:manage` and uses only the approved server configuration.
- Follow-up create/update routes require `clients:write`; access management requires installation ownership for the first release.
- `POST /websites/:id/changes` records a bounded change request under `client-changes:request`; change detail routes expose only that website's sanitized status and preview metadata.
- `POST /websites/:id/changes/:changeId/publish` requires `client-releases:publish`, the current candidate identity, and an idempotency key. It creates a release job rather than claiming the website is already live.

Define typed request/response contracts and error categories before implementing handlers. Return not-found responses for record IDs outside the caller's scope. Never accept arbitrary upstream paths, secrets, tenant identities, or role claims from the browser.

## Website updates and publishing

Keep content authoring in the separate website AI workflow. This module provides the request, preview, approval, and release interface; it adds no Pages or Media section, HTML editor, or drag-and-drop builder.

Pair a local operator bridge with the Vitruous installation through a revocable, site-scoped machine grant. That grant can claim approved job types and report results; it cannot create a human publication approval or expand its allowed websites. Map each website ID to an explicitly approved local checkout, installed harness version, publication path, Cloudflare account/project, and canonical origin. Keep filesystem paths and deployment credentials in the bridge's private configuration. The Worker returns structured operations, never executable shell text. The bridge uses typed adapters and fixed commands; request text is data for the authoring session.

The current module router requires a browser session, so machine access needs a narrowly defined, separately authenticated runner API. Gate it by the same canonical host and explicit module enablement before checking hashed machine credentials, website scope, lease, and allowed operation. Keep the existing browser session and Origin gates for human routes. Runner claims must recheck that the approving user is active and still authorized, that approval matches the current candidate, and that the lease is current. Disable new claims when the module or grant is revoked; an expired job cannot later execute from an offline queue.

For website updates, use the website harness's existing active-agent prepare/work/complete loop and its change-scoping behavior. The current harness explicitly rejects an external-worker authoring mode. The first version must therefore hand off to Jack's active coding-agent session, through a supported host integration when available or a concrete copy/open handoff otherwise. A request awaiting that handoff stays visibly pending. Do not promise unattended cloud authoring or silently launch a paid agent CLI. A seamless dashboard-to-agent connector is an explicit integration deliverable if the host supports it.

The website change lifecycle is **Requested → Awaiting agent → In progress → Preview ready → Publication queued → Publishing → Published**, with distinct blocked, failed, canceled, and publication-uncertain states. Acquire a per-website lease before modifying or publishing, detect a changed base revision, and prevent concurrent jobs from mixing files or publishing a newer unreviewed change. Use isolated worktrees or equivalent candidate directories when the existing workflow permits them. Record the source revision, built artifact identity, preview, actual check results, and authoring provenance.

At Preview ready, show Jack the change summary, preview, and actual validation coverage. **Publish** authorizes that website, candidate, and production target. A changed source or artifact invalidates this approval. The paired bridge runs the site's existing publication path and reports the deployment identity and canonical-site smoke result before the dashboard says Published. Lost callbacks are reconciled against the deployment receipt instead of blindly retrying a production write. A canceled queued job must not publish later; cancellation during an upload reports the actual outcome.

Respect each website's configured release policy. The current website harness defaults ordinary publication to quick publish with build, asset, staged-file integrity, and HTTP smoke checks; a requested full review adds its existing browser and workflow gates. Initial creation retains its full preview acceptance, preservation sites remain preview-only, and signed-Worker or hosted paths retain their own contracts. Show build-only versus full review accurately. Never silently replace a site's publication method or label skipped checks passed.

Bind publication to the reviewed candidate at the actual upload boundary. If the site's CLI rebuilds before upload, the bridge integration must compare the staged candidate identity before upload or add an explicitly reviewed exact-candidate interface to that harness. The current admin connection does not supply update or publish endpoints, and the existing website CLI does not by itself supply a remotely claimable job service. Implement and test this bridge contract as part of the first release rather than treating analytics credentials as deployment access.

When the bridge is offline, keep requests durable and show that execution is waiting for Jack's connected environment. The first release can initiate jobs from anywhere; execution requires the paired environment and, for authoring, the active agent session. Always-on hosted execution is a later deployment choice. A rollback is a separate action targeting a known prior release and follows the site's supported procedure; publishing a new candidate never implies that backend records or migrations can be rolled back automatically.

## Delivery sequence

1. Create a synthetic prototype for Jack with several clients, multiple websites for one client, a failed analytics connection, and an update-to-publication flow. Review the portfolio and website workflow before building the full interface.
2. Implement module contracts, permissions, additive schema, client/site records, and follow-ups in an isolated local installation. Prove disabled-module behavior and record isolation before adding remote data.
3. Add approved connection configuration, individual secret bindings, the reusable request validator, and synthetic multi-backend tests. Verify independent failures, revocation, and remote identity mismatch handling.
4. Build the portfolio and individual website analytics views, cache, coverage accounting, and partial failure states. Verify desktop and mobile interactions.
5. Implement website change records, machine grants, bridge pairing, active-agent handoff, previews, candidate approval, and publication receipts. Prove the entire flow on an isolated test website, including an offline bridge and an approval invalidated by source changes. Check host integration support before promising automatic agent handoff.
6. Run `npm run check` and installation checks from packed packages outside the workspace. Test both the enabled variant and an ordinary installation without the module. Exercise bridge and release adapters against isolated fixtures and a designated test target.
7. Prepare the private Vitruous installation diff, resource ownership inventory, D1 backup and migration instructions, credential rotation/revocation procedure, bridge setup, and rollback plan. Pilot one explicitly selected website, then onboard the rest independently after verification. A module rollback disables its routes, job claims, and grants while retaining additive tables; it does not drop existing data or cancel an already completed publication.

Implementation release checks must cover unauthorized and disabled access; ordinary admins making no portfolio requests; forged or cross-client IDs; restricted users being unable to infer aggregate data about other websites; exact origins; CSRF; concurrent edits; malformed/legacy analytics; unavailable optional metrics; timezone and weighted-rate calculations; stale and partial results; grant revocation; and migration from the previous supported schema. Verify secrets and real client data are absent from packed artifacts. Explicit local mode and the exact loopback origin remain necessary for demo access, including when portfolio connections are configured; production connections never permit demo authentication.

The plan itself changes no runtime behavior or cloud resources. Deploying the Vitruous variant, installing a client grant, upgrading an older client backend, or enabling collection each requires the relevant installation's explicit rollout scope. Module work must never deploy or migrate a shared existing backend as a side effect.

Release integration checks must also cover wrong-site machine grants; revoked runners; unauthorized publication; replayed approvals; changed candidates; duplicate job delivery; concurrent updates; interrupted uploads; lost receipts; offline bridges; sanitized logs; preservation sites; and build-only versus full-review policy. A verified preview alone must never trigger production publication.

## Later capabilities

Add client lead views and status changes only with separate website grants and user permissions. Keep client logins in the existing business admins initially; a future shared client portal needs explicit website membership and isolation across every API and aggregate. Add internal collaborators through explicit site and action grants, including a distinction between preparing changes and publishing them. Always-on execution, cross-admin single sign-on, billing, proposals, automated reports, and provisioning are independent extensions rather than prerequisites for this variant.
