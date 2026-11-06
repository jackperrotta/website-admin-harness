# Client-approved organization reporting

Version 1.2.0 adds an optional v1 machine pairing issuer and a public `@tryvitris/website-admin-harness/pairing` SDK. The private Vitris Websites module is its initial consumer. Installing the package does not enable or deploy pairing. Human webmaster memberships never authorize cross-installation machine reads.

## Explicit installation diff

Read WORKFLOW.md and refs/harness.md and refs/webmaster.md. Preserve the exact installation/site/backend identities, existing users, password verifiers, forms, bindings and billing. The client must already have a working `vitris-harness` backend. Pairing proxies its existing status and analytics; it creates no collection/history and never exposes its original backend credential.

Enable `webmaster` and explicitly add this manifest property in the client installation:

```json
{"reportingPairing":{"trustedWebmasters":[{"installationId":"REVIEWED_CONSUMER_INSTALLATION","siteId":"REVIEWED_CONSUMER_SITE","adminOrigin":"https://admin.reviewed-domain.com","organizationId":"REVIEWED_ORGANIZATION","organizationName":"Reviewed organization"}]}}
```

Initially configure only the owner's actual Vitris admin. Obtain these exact public identities from that installation, independently review them, and keep them out of generic defaults. The runtime rejects production loopback peers. The name comes from this trusted configuration. This is installation/origin verification, not third-party legal-business verification.

Back up the client's owning D1 and apply core migration 0011 if needed, then optional `modules/webmaster/migrations/0012_reporting_pairing.sql` after local migration review. Copy this optional migration deliberately; ordinary core upgrade does not install it. It adds four scoped tables and a relationship-revocation trigger; it does not change users or backend records. Use a SQL migration runner that preserves trigger bodies (do not split the file on every semicolon). Runtime never creates tables or seeds existing business records.

Install a separate 32-byte lowercase hex secret `WEBMASTER_PAIRING_KEY` on the client Worker/Pages project using private secret tooling. Generate it offline; never put it in a manifest, browser asset, audit or source control. It encrypts short-lived approval codes and recovery receipts, bound to installation/site/origin/request. Preserve a secure recovery copy. Rotation requires a reviewed migration or deliberate expiry of pending recovery state. Do not reuse billing, password or backend tokens as encryption keys.

The central consumer requires its existing `WEBMASTER_SETTINGS_KEY` vault plus a separate private P-256 JWK `WEBMASTER_PAIRING_SIGNING_KEY`. The same signing key must serve its proof hook and sign requests. Keep a recovery copy: replacing it invalidates existing pins and requires explicit re-pairing. A client owner approves each new request even when that organization already manages the site. No automatic key repinning occurs.

## Flow and wire contract

The contracts package exports v1 identities, DTOs, `pairingPaths`, scopes and policy constants. All machine requests are JSON signed envelopes containing exact consumer identity, issuer admin origin, canonical path, epoch-seconds timestamp, nonce, SHA-256 token hash and action data. `x-webmaster-signature` signs the exact serialized envelope with ECDSA P-256/SHA-256. Credential actions also carry `Authorization: Bearer TOKEN`. Envelopes expire outside a 90-second skew; nonces are single use.

Endpoints under `/api/webmaster-reporting/v1`:

| Endpoint | Authorization and result |
| --- | --- |
| GET capabilities | Explicit issuer identity, website origin, v1, exact analytics-only scope and fixed paths |
| POST request | Trusted signed consumer; `{requestId,challenge}` (PKCE S256), 10-minute approval request |
| GET approval?id=ID | Client owner session; public request details only |
| POST approve / reject | Client owner session, same Origin, explicit approval; no token/code in response |
| POST poll | Pinned consumer signature; pending or approved server-side code |
| POST exchange | Pinned signature plus `{requestId,code,verifier}`; one dedicated machine credential |
| POST report | Pinned signature + credential; `{grantId,operation:'status'}` or analytics with `days:14` or `30` |
| GET grants | Client owner session; grant identity, creation/last-use/revocation only |
| POST revoke-grant | Client owner session + Origin; `{grantId}` |
| POST rotate / revoke | Pinned signature + credential; `{grantId,operationId}` |

First contact challenges the explicitly trusted consumer at fixed `/api/modules/websites/hooks/pairing`. The HTTPS response must sign that random challenge with its advertised public key and exact identity. That key is pinned on request/grant. Arbitrary caller-provided callbacks, redirects, browser tokens and human roles cannot substitute. All peer calls have timeouts, response bounds and `redirect:'manual'`; the private consumer additionally checks public DNS addresses. Fixture transports require explicit local mode and exact loopback admin origin; never enable them in production. Pairing-configured local issuers do not permit demo login.

Each request ID binds one immutable intent. Start/poll retries use fresh envelopes/nonces. Exchange is single use; the same code/verifier can recover the same encrypted response for 10 minutes, including after original code expiry, while the grant remains valid. A changed exchange fails. Rotation/revocation use stable operation IDs with 10-minute recovery receipts. If recovery expires, begin explicit owner-approved pairing again. Completing a new pairing supersedes earlier grants for that same consumer and organization. Broad client backend tokens stay exclusively server-side. Issuer grants store token hashes; the central vault encrypts the entire credential and its pinned identities.

Errors return JSON `{error,code}`: 400/415 invalid input, 401 invalid credentials/signature, 403 untrusted identity/owner/permission/revoked access, 404 disabled or unknown route, 409 replay or conflicting intent/revision, 410 expired/revoked approval, 429 throttled start, 503 missing migration/key or unavailable peer. Clients fail closed and show retry/re-pair guidance. A lost mutation response is not evidence of failure; retry the same operation rather than creating another mutation.

## Organization lifetime, billing and recovery

Approval can create a missing webmaster relationship with zero people and billing disabled. It never changes client ownership or overwrites an existing disconnected/different organization: review that relationship in Settings first. Removing/deactivating one person revokes that person's login access, not the organization's machine grant. Explicit grant revocation or disconnecting/changing the organization invalidates reporting, including in-flight reads. Reconnecting the relationship cannot resurrect revoked grants. The database trigger enforces organization revocation even when an older runtime writes the relationship during rollback. Do not remove it or grant records as a rollback step.

Status and 14/30-day analytics are the only supported reads. No leads, financial writes, subscriptions, charges or Stripe credentials. Report responses whitelist analytics fields and omit backend scopes/tokens. Activity records attribute owner decisions to the person and machine mutations to the approved organization. Secret values and approval codes never enter browser responses or audits.

Central pause excludes the source and stops new checks without revoking its grant. Disconnect pauses locally before attempting upstream revocation; an unconfirmed result remains paused and recoverable. Paired cache reads require a fresh issuer grant check; cache writes and final responses are fenced by connection revision. Previously displayed data is not remotely erased, but new reads cannot use revoked access.

Rollback may restore the preceding deployment while retaining additive tables, trigger and keys. This disables new pairing routes; it does not reverse payments or delete legitimate changes. Restore a database backup only as a separately reviewed recovery action. Test issuer and consumer from the same packed contracts/runtime outside the workspace, owner/Origin/tenant failures, replay/expiry, wrong keys/audience, dropped responses, rotation, organization vs member revocation, in-flight/cache fencing, desktop/mobile, and existing billing before deployment.
