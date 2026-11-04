# Optional Stripe billing for an installation

The harness supplies reusable source, contracts, permissions, UI, an optional migration and recovery behavior. The agent chooses and reviews the business-specific configuration. No business inherits the prototype’s customers, service names, prices, currency, account, or client grants. Existing website collection, backend grants, login accounts and origins remain intact. Never deploy another installation or migrate a shared backend as a billing setup side effect.

## Prepare an installation diff

Keep environment files, business billing configuration, private rollout notes, provider reports and client grants in this installation's ignored `.vitris/stripe/`, outside the reusable harness checkout. Ignore `.vitris/`, `.dev.vars*`, `.env*` and `*.env`; production keys belong in this installation's Cloudflare secret store. Package upgrades do not activate billing, copy keys or change existing configuration. Every installation opts in separately. Never include business credentials or real deployment records in public examples, package assets or Git history.

Read WORKFLOW.md, the intended installation’s manifests, both Worker entry points, D1 ownership, existing schedules, and release policy. Inventory the business’s Stripe account and separate test/live environments. Keep the actual billing configuration in private installation source; never place credentials in a manifest or browser asset. Keep existing module sources when upgrading the harness.

Create a private configuration file with the business’s own account ID, explicit mode and currency, a list of approved Stripe price IDs, and an optional reviewed portal configuration ID:

```ts
import {createStripeBilling} from '@tryvitris/website-admin-harness/billing';

export default createStripeBilling({
  accountId: 'acct_REPLACE_WITH_OWN_ACCOUNT',
  mode: 'test',
  currency: 'usd',
  prices: [], // Add this business's real test price IDs after review.
  // portalConfigurationId: 'bpc_REPLACE_WITH_OWN_CONFIGURATION',
  allowLiveWrites: false,
});
```

`prices` approves fixed monthly, annual, and one-off Checkout prices. Prices are fetched from Stripe and must be active and match the configured account mode and currency. The harness does not create a service catalog automatically. Configure the customer portal’s allowed plans, payment-method updates and cancellation policy deliberately in Stripe, then pin its configuration ID. Portal settings govern portal changes; the Checkout price allowlist does not rewrite that portal configuration. Native immediate-price/proration editing is outside this initial integration.

Run `vitris-admin billing-plan --dir EXISTING_ADMIN --from PRIVATE_BILLING_CONFIG.json` to generate an ignored installation checklist and digests. This command makes no account requests, secret changes, migrations, or cloud writes. Review the actual source/configuration diff before applying it. Use `vitris-admin module --dir EXISTING_ADMIN --slug billing --name Billing` for new module source, then replace the read-only scaffold with the trusted factory. Do not overwrite an existing module with that ID.

Import that definition into both existing Worker entry points, add it to `createAdmin(config, {modules: [...]})`, and enable `billing` only in the intended manifests. The actual module disables demo login, including in local mode. Use the installation’s real account lifecycle for sign-in; test fixtures are not an authentication adapter. The separate `/prototypes/billing` export remains explicitly synthetic and local-only.

Inspect the actual deploy script before choosing the adapter. Preserve an existing explicit `createPagesAdmin(config, {modules: [...]})` installation and its mail bindings. That adapter exposes HTTP handling only, so prepare a separate scheduled Worker for billing with the same installation manifest, billing configuration and owning D1 database. Invoke only the billing module's scheduled handler when another Worker already owns account mail or appointment jobs; do not duplicate the whole admin scheduler. Review its cron, secrets and disabled public routes explicitly. Native Worker installations retain their combined scheduled handler. Billing setup does not authorize a hosting migration.

## Database and private bindings

The optional additive migration is `modules/billing/migrations/0010_stripe_billing.sql` inside the runtime package. It is excluded from ordinary migrations. Apply it deliberately to the owning local database first, after the existing core/account schema. Back up an existing dedicated database before a separately authorized remote application. Never renumber or edit applied migration files.

Every record is scoped by installation, manifest site, Stripe account and test/live mode. The module adds customers, cached provider records, private invoice drafts, operation receipts, pending Checkout claims, a webhook inbox, reconciliation cursors and rate limits. These tables contain no credentials. A configuration change to another account or mode does not adopt existing records automatically. Link existing Stripe customers by reviewed customer ID; never match accounts automatically by email or import every account customer.

Install `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` privately with Wrangler secret stdin or the secret API, preserving all existing secrets. Do not pass raw values as command arguments or print them. Test mode needs a test/sandbox key; a live key cannot validate sandbox acceptance. Hosted Checkout and portal flows do not require a publishable key in browser code. Do not add remote Stripe scripts or collect card details in the harness.

Read-only account verification calls `/v1/account` and `/v1/balance` and checks the pinned account and mode. It does not prove payment collection or webhook delivery. Review the key’s required permissions: account/balance read, approved prices/products read, customer read/write, Checkout/portal session creation, invoices/items read/write/finalization/sending, subscriptions read/update, and payment-intent read for reconciliation. Use a business-owned restricted key where those permissions are available. Never substitute a broad key silently when a restriction is rejected.

Live Stripe mutations require both `allowLiveWrites: true` in reviewed installation configuration and `BILLING_LIVE_WRITES=1` in that installation’s environment. Keep both disabled until sandbox acceptance and a separate live rollout. Disconnecting the module, revoking a client grant, or removing a secret does not cancel existing Stripe subscriptions.

## Webhooks and recovery

Configure the exact canonical endpoint `/api/modules/billing/hooks/stripe` on the owning admin origin, using snapshot events with API version `2026-10-28.endive`. Register invoice lifecycle/payment events, customer subscription lifecycle events, Checkout completion/expiration/asynchronous-payment events, and payment-intent lifecycle events. Thin events and other API versions are not silently accepted.

Verify provider details against [Stripe API versioning](https://docs.stripe.com/api/versioning), [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create), [invoice item attachment](https://docs.stripe.com/api/invoiceitems/create), [customer portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal), and [webhook handling](https://docs.stripe.com/webhooks) when changing this contract.

The exact registered hook bypasses browser session/Origin checks and uses raw-body HMAC verification with a five-minute timestamp tolerance, account/mode/version checks, bounded input, durable duplicate detection, and customer ownership checks. Regular module mutations retain canonical host, active session, permissions, and exact Origin checks. Unknown Stripe customers are ignored rather than automatically imported. Inbox rows store object references and sanitized failure codes instead of raw event payloads.

Preserve the returned `scheduled` handler when wrapping `createAdmin`. Review existing cron capacity and add a deliberate schedule, normally once per minute. The handler drains bounded event batches and paginated customer reconciliation, and periodically refreshes known customers to recover missed events. It reuses the existing installation’s Worker and D1; no Queue or additional paid service is required. Pages fetch-only adapters need an explicitly configured Worker scheduler; do not assume that a Pages fetch export drains cron work. The dashboard exposes queued/failed work, customer sync, and retry controls.

Requests use durable intent hashes, per-operation leases and stable Stripe idempotency keys for each workflow step. A response lost after provider acceptance stays uncertain and retries the same intent. It does not create a replacement charge or subscription. Operations older than 23 hours require manual reconciliation because Stripe’s API v1 idempotency retention is limited. Inspect Stripe objects and stored step references before recovering an old operation; never clear operation/offer/draft locks blindly. A code rollback or D1 restore does not reverse a payment.

Invoice drafts remain local and editable. Finalization creates a customer-paid invoice with automatic advancement disabled, explicitly attaches each line to that invoice, checks the final total against the reviewed draft, and finalizes it without sending email. Sending is a separate, reviewed action. Quantity is included in the description and applied to the line amount. This first integration rejects a total changed by inherited tax or customer settings rather than finalizing an unreviewed amount. Off-session collection, native refunds/credit notes, usage billing and native tax editing are separate reviewed additions.

Stripe's test-mode invoice-send API accepts a send and emits `invoice.sent` without delivering an email. Verify the module's idempotent send operation separately from mailbox delivery. For an actual sandbox email, use the Dashboard's **Send test invoice** action with an explicitly approved inbox that has access to that sandbox, review the email preview/PDF/payment links, and obtain recipient confirmation. Neither `invoice.sent` nor an HTTP 200 proves inbox delivery. See [Stripe's send API](https://docs.stripe.com/api/invoices/send) and [sandbox customer-email testing](https://docs.stripe.com/billing/revenue-recovery/customer-emails#test-your-configuration).

Use [Stripe test clocks](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) and test PaymentMethod aliases to exercise actual renewal, decline, scheduled retry, recovery and exhausted-retry transitions. Link only the simulation customer to its isolated installation. Allow enough time for bounded webhook processing; query current provider state and the customer-scoped read model rather than treating a redirect or stale event as payment evidence. Review the business's retry count/window, exhausted-retry action, invoice treatment and notification settings independently for live mode. Do not silently copy sandbox defaults or change account-wide settings while testing one customer.

## Separate client admin access

An optional **Managed by Webmaster** relationship uses `refs/webmaster.md`. It identifies the managing organization and records whether it also provides billing, but grants no billing access or automatic pairing. A management-only relationship requires no billing module. Keep client billing independent so disconnecting management access preserves subscription visibility and the customer's payment-management route.

Create a random customer-specific machine token privately, install it as `BILLING_ACCOUNT_TOKEN` on that client’s Worker, and store only its SHA-256 digest in the seller’s private `grants` configuration. Pin the local billing customer ID, caller installation ID, site ID, exact admin origin, enabled state and management permission. Use one grant per permitted client installation. An admin covering multiple websites must be allowed to see that entire billing customer account before receiving a grant.

Register `createBillingAccount({sellerOrigin, sellerInstallationId, sellerSiteId, grantId, customerId, mode})` under the `account-billing` ID in the client’s two Worker entry points and enable it explicitly. It uses the client’s existing active-account checks and billing capabilities. The browser never receives the seller’s Stripe key or the machine token. The server resolves the customer from the grant and refuses arbitrary destinations, redirects, foreign invoice IDs and mismatched installation identities. Production seller origins must be approved public HTTPS origins; loopback pairing is local-only.

The fixed machine endpoint is `/api/modules/billing/hooks/account`. Its token and scope checks authorize only the mapped customer’s read model, invoice/payment document links and, when explicitly permitted, portal session creation. Drafts, internal operation records and other customer data are omitted. Portal sessions use the registered client admin origin as their return URL and are never stored in the journal or audit log. Removing/disabling the seller grant revokes future access; no client data fallback is substituted during an outage.

## Acceptance and rollout

Run `npm run check`, consume packed packages outside this workspace, and verify both disabled and enabled installation variants. Fixtures prove the protocol and failure handling, not real Stripe account acceptance. Complete sandbox customer creation, subscription/one-off Checkout, extra authentication/asynchronous outcomes, invoice finalization and authorized delivery, client portal actions, renewal failure/recovery, duplicate/late/missing events and expired operation recovery before proposing live rollout.

Keep local test credentials in ignored files. Never send tests to customer recipients or enable live writes as an installation side effect. Produce a private release diff with exact resource identities, permissions, backups, secret rotation, webhook version, scheduler setup, supported policies and recovery instructions. Deploy only to the named business installation after authorization, then verify its real authenticated canonical origin and record the deployed revision.
