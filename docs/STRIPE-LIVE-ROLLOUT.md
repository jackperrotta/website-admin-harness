# Stripe billing rollout preparation

This is the reusable installation procedure, not a deployment authorization. Each business receives its own configuration, Stripe account, hostname, database and reviewed client grants. The sandbox acceptance environment and its low-value test prices are private test resources; they are not business defaults.

## Keep installation data outside the harness

Store a business's local Stripe environment files, runtime billing configuration, intake, rollout plans, provider reports and client grants inside that business admin project's ignored `.vitris/stripe/` directory. Ensure the installation ignores `.vitris/`, `.dev.vars*`, `.env*` and `*.env`. Use that installation's private Cloudflare secret store in production. Do not keep business credentials or deployment records in the harness checkout, package source, examples, compiled UI or public Git history. Public examples contain placeholders and synthetic data only.

Updating the harness package does not configure Stripe, enable the module, copy credentials, apply its optional migration or enable live writes. Each installation opts in explicitly, owns its configuration and credentials, and chooses its approved account/catalog/policies. Separate installations do not inherit another business's customers or grants. Multiple websites owned by one business may use the same business Stripe account only when deliberately configured; use separate restricted keys and exact installation scopes.

The workspace verifier requires explicit installation paths and performs account/mode reads only:

```sh
npm run stripe:verify -- --env ../business-admin/.vitris/stripe/sandbox.env --config ../business-admin/.vitris/stripe/sandbox.config.json
```

Its report defaults to `test-verification.json` or `live-verification.json` beside the supplied configuration; `--report` can choose another private destination. There is no shared harness credential fallback. Run `npm run check:privacy` before committing/pushing harness changes. The normal check includes this scan, and the release pack/publish commands scan actual archives for recognized credentials and private files before publishing. These checks supplement review; they cannot identify every possible private business detail or unrecognized credential format. Keys previously shared in chat must be replaced privately before live rollout.

## Review the installation and release

Identify the first seller installation and its exact canonical admin origin, existing manifest, owning Worker/D1, core migration history, current users, enabled modules, schedules, business Stripe account and release policy. Record the package/archive digest and source revision in that installation's private rollout plan. Keep all existing forms, origins, users, backend connections and module source. Review the explicit diff produced by `vitris-admin billing-plan --dir EXISTING_ADMIN --from PRIVATE_CONFIG.json`; the planner does not deploy or migrate.

Build release archives in an isolated stable checkout/output tree. Verify their public entry points and hashes, then run the packed external installation checks against those exact archives. Concurrent builds of the neighboring website harness clean generated output and can otherwise yield incomplete archives. Never publish an archive merely because the same source passed earlier.

The candidate adds the optional `billing` factory, compiled billing UI, contracts, exact signed-hook registration, bounded scheduled processing and optional migration `modules/billing/migrations/0010_stripe_billing.sql`. A separate paying client enables `account-billing` with its customer-bound grant. Ordinary installations remain disabled. Review seller read/customer/invoice/subscription/connection capabilities and the client's read/manage capabilities; browser login, role checks and exact Origin checks remain mandatory. A subscription payment result does not automatically change the client's website access policy.

Inspect the actual deployment script as well as Wrangler files. An existing installation may use the explicit Pages adapter even when a Workers configuration is also present. `createPagesAdmin` exposes HTTP handling only; it does not run the module's scheduled handler. Preserve that installation's hosting and authentication adapter and prepare a separate, explicitly reviewed scheduled Worker for billing. Bind only its owning D1 database and required billing secret, use the same installation manifest and billing configuration, and invoke the billing module's scheduled handler directly. Do not run the whole admin scheduler again if another Worker already owns account mail or appointment tasks. Disable public Worker routes and preview URLs. Native Workers installations can retain the existing combined scheduled handler instead. Cron scheduling is an installation choice, not an extra shared backend or automatic hosting migration.

## Confirm live account policy

1. Pin the live account ID, currency, actual approved live price IDs and a deliberately configured live portal. Sandbox prices and portal IDs cannot be reused as live configuration. Review plan-change timing, proration, cancellation and payment-method policies.
2. Review retry count/window and behavior after the first failure and exhausted retries. Decide whether to cancel, pause, mark unpaid or retain past-due, and how to treat the invoice. Stripe's policy determines these provider transitions; the harness reflects them. Test the selected policy in sandbox before enabling it live.
3. Review sender branding, support contact details, invoice legal/business details, PDF attachments, finalized-invoice delivery, failed-payment and authentication reminders, renewal notices and successful-payment receipts. Check for duplicate notifications if another workflow already sends billing mail. The acceptance sandbox had optional renewal/failure/authentication notices disabled; those settings are not a recommended live policy.
4. List the payment methods to enable for the first rollout. Card renewal/decline/3D Secure acceptance does not prove bank-debit or other asynchronous methods. Keep unaccepted methods disabled for that rollout, or complete their pending/success/failure acceptance before enabling them.

## Provision deliberately

Back up the dedicated database and record its existing migration state. Apply the additive optional billing migration to an isolated copy first, preserving existing users/records, then prepare the exact owning database command for separately authorized remote execution. Never apply it to a shared backend as a side effect.

Install a fresh business-owned restricted live key with account/balance read, approved price/product read, customer read/write, Checkout/portal creation, invoices/items read/write/finalize/send, subscription read/update and payment-intent read. Confirm the actual permission set with the verifier and approved sandbox operations; an untested restricted key is not ready because a standard sandbox key passed. Supply credentials through private Worker secrets, never a public manifest or browser asset. Maintain separate test/live secret values and webhook signing secrets.

Collect missing choices in an ignored, non-executable intake file before generating the runtime billing configuration. Required inputs are the live account ID, privately supplied live key, approved catalog and currency, portal policy, invoice and payment-notification policy, and reviewed customer/client mappings. The hosted Checkout and customer portal integration does not need a publishable key. Obtain the endpoint-specific signing secret after preparing the actual live webhook; a local CLI secret does not apply. Keep both live-write gates disabled throughout preparation. Do not copy previously shared keys into a live release; request a fresh private credential file.

Register a live snapshot webhook at `https://EXACT_SELLER_ADMIN/api/modules/billing/hooks/stripe` with pinned API version `2026-10-28.endive` and the invoice, subscription, Checkout and payment-intent lifecycle events used by the module, including failed/action-required/processing outcomes. Confirm raw-body signature verification and real delivery; the CLI signing secret is local-only. Preserve the exported scheduled handler and review a bounded cron schedule, normally once per minute, alongside existing schedules. No additional mail provider, Queue or shared billing service is required.

Generate a fresh per-client machine token, install it privately on that client Worker and pin only its digest in the seller grant with the correct customer, installation/site IDs and exact return origin. Confirm revoked and cross-customer access fail before handing out client access. Never grant the seller key to a client installation.

## Enable and verify after approval

Stage the installation with `allowLiveWrites: false` and `BILLING_LIVE_WRITES=0`. Verify its account/mode, authenticated canonical origin, disabled/unauthorized behavior, migration, registered webhook and scheduler. Review the concrete source/resource/secret diff and backup/recovery plan before authorizing deployment and financial activation. Turning on billing requires both reviewed configuration and `BILLING_LIVE_WRITES=1` for that specific installation.

After an authorized deployment, record the deployed revision and verify actual authenticated seller/client scopes, approved catalog, empty/existing records, webhook delivery and pending/failed work. The first genuine customer invoice/subscription must be deliberate, with the actual recipient, amount, terms and service. Do not create a live test charge or invoice just because sandbox tests passed.

## Recovery

Disable new financial writes first if an incident occurs; keep reads, signed-event receipt and reconciliation available where possible. Inspect Stripe objects and durable operation receipts before retrying. Reuse the same intent key for an uncertain result; requests older than 23 hours require manual reconciliation. Do not clear invoice/offer/operation locks or resend invoice mail blindly.

Rolling back code, restoring D1, revoking a grant or removing the module does not reverse a charge, delete a Stripe invoice or cancel a subscription. Preserve provider IDs and reconcile the authoritative state after recovery. A refund, credit note, cancellation or invoice correction is a separate reviewed financial action.
