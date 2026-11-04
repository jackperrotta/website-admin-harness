# Billing module execution plan

Add optional billing infrastructure to the admin harness so each business can use its own Stripe account to sell subscriptions, collect one-off payments, and prepare invoices. Connect billing records to the existing Clients workspace where that module is available. Paying clients see their own subscriptions, invoices, and payments from their separate website admin login and can update payment details, change eligible plans, and cancel.

Confirmed scope on November 4, 2026: separate business installations and Stripe accounts; no central Vitris payment platform. Clients use their existing website admin accounts. Self-service includes payment updates, eligible plan changes, and cancellation. This document plans implementation; it does not enable billing, contact customers, charge cards, deploy Workers, or migrate remote databases.

## Product structure

Ship two separately enabled, trusted modules. Proposed IDs are `billing` for a business collecting money and `account-billing` for a client paying another business. A business can enable both. Keep the current core navigation intact; show Billing and Your billing only when their respective modules are registered, enabled, and authorized. An unconfigured module shows its setup state, with financial actions unavailable until setup is verified. Do not add Pages, Media, or an HTML editor.

The seller module works without `client-portfolio`. It includes a small billing customer directory and accepts explicit links to a production portfolio client or another approved customer source. An installation without a portfolio can still issue an invoice to a customer who has no website admin. That customer pays through a Stripe-hosted page. In the Vitris installation, Clients gains billing summaries and a Billing tab that opens the same customer records and actions.

| Seller view | Behavior |
| --- | --- |
| Overview | Active subscriptions, customers needing attention, collected payments, outstanding invoices, and upcoming renewals. Show recurring totals separately from one-off payments, with separate totals per currency and a visible reporting period. |
| Customers | Contact and billing information, subscription status, outstanding balance, linked clients/websites, and payment history. |
| Subscriptions | Create a subscription offer, select monthly or annual prices, inspect renewals, preview changes, schedule changes, and cancel. |
| Invoices | Draft itemized service invoices, preview totals, finalize and send, inspect payment status, and void eligible unpaid invoices. |
| Payments | Inspect successful, pending, failed, and refunded payments and open the associated invoice or Stripe record. |
| Catalog | Maintain recurring plans and one-off services, supported prices, and which plan changes customers may select. |
| Connection and settings | Account identity, sandbox/live mode, setup readiness, portal configuration, invoice settings, sync health, and disconnect behavior. |

Your billing shows the supplier, current subscriptions, amount and frequency, next billing date, scheduled changes, outstanding invoices, paid invoice history, downloadable documents, and payment status. It offers Pay invoice, Update payment method, Change plan, and Cancel subscription when applicable. A client must never see internal seller notes or another customer's data.

## Current implementation and prerequisites

The harness already supplies trusted module registration, canonical-host checks, authenticated sessions, permissions, D1 migrations, compiled React interfaces, and release/package tests. The current Clients workspace is implemented in `packages/admin/src/client-portfolio/prototype.ts` and `packages/admin/ui/src/client-portfolio/workspace.tsx`. It is restricted to local installations, stores a prototype snapshot, and supports live analytics through a private adapter. It is not a production customer registry.

Build durable production client identity and the limited Clients integration needed for billing. Preserve the prototype and its simulated website-change workflow. This work does not require implementing the separate website publishing bridge or replacing existing analytics connections. Do not make financial records depend on prototype names, example IDs, or a mutable JSON snapshot. Keep portfolio enablement independent of billing enablement.

The current module handler requires a browser session and mutations require the exact admin Origin. Stripe webhooks and communication between separate installations need distinct authentication paths. Add narrowly scoped route handling rather than exempting all billing routes from session or Origin checks. Preserve existing auth, booking, calendar, account-mail, and scheduled handlers.

## Stripe connection and installation boundaries

Each seller installation calls Stripe directly using that business's account credentials held in Worker secrets. Show a guided Connect Stripe setup and verify the resulting account ID and capabilities server-side. In the first release, credential installation is a deliberate private deployment/setup step; the browser receives readiness and account metadata only. Do not suggest that clicking a button can authorize access before credentials are configured. A future OAuth or Stripe app connection would require its own explicit architecture decision.

Pin a supported stable Stripe API version and a webhook payload contract. Validate the SDK or typed adapter under the actual Workers runtime and packed consumer build. Use separate sandbox and live secrets, signing secrets, customer links, and provider IDs. A key rotation must retain the same verified account; changing to another account requires an explicit new connection and migration plan. Never silently relink existing invoices or subscriptions to a new account.

No Stripe credential is copied into a client installation. Keep private business configuration, customer data, account IDs, and secrets out of public package fixtures and shipped examples. Existing admin origins, users, forms, backend grants, and business databases remain intact. There is no central Vitris billing database or Stripe Connect platform in this scope. Stripe documents Connect as the model for a platform extending payment processing to connected merchants; this design uses independent merchant installations. See [Stripe SaaS and Connect guidance](https://docs.stripe.com/connect/saas).

Use Cloudflare Workers and D1. Serve payment collection through Stripe-hosted Checkout, hosted invoice pages, and the customer portal. Authentication mail stays on Cloudflare Email Service. Configure Stripe to send its billing invoices and receipts deliberately, avoiding duplicate harness notifications. R2 is unnecessary initially because Stripe hosts invoice documents. Add no additional paid service, mandatory Queue, or new resource to installations where billing is disabled.

## Customer identity and records

Scope every business query by the manifest site ID and installation identity. Stripe object uniqueness also includes account identity and sandbox/live mode. Use integer amounts in the currency's supported smallest unit, validated currency codes, bounded input, foreign keys, and revision checks. Never identify customers solely by email address or match them automatically to existing users by email.

| Record | Purpose |
| --- | --- |
| Connection metadata | Verified Stripe account, mode, configuration revision, API version, readiness, and secret reference without the secret value. |
| Billing customer | Stable customer ID, business scope, Stripe customer ID, billing contact, optional portfolio client link, and archive state. One customer can cover several websites. |
| Products and prices | Recurring plans, one-off services, immutable price references, active/archive state, and customer-visible plan-change eligibility. |
| Subscription and items | Stripe IDs, customer ownership, quantities, prices, lifecycle state, current periods, trials if configured, cancellation and scheduled changes. Support multiple subscriptions per customer. |
| Invoice and lines | Customer ownership, draft revision, descriptions, quantities, amounts, currency, due date, status, Stripe reference, and document availability. |
| Payment summary | Associated customer/invoice, provider status, amount paid or refunded, and timestamps. Do not store card numbers or security codes. |
| Operation journal | Actor, request intent, revision, idempotency key, provider object reference, and pending/succeeded/failed/uncertain result. |
| Webhook inbox and sync work | Unique provider event identity, bounded metadata, processing state, retry lease, attempts, and sanitized errors. |
| Client installation grant | Exact client installation/site/admin origin, owning billing customer, permitted operations, credential hash, and revocation state. |

Add the next available numbered additive D1 migration at implementation time. Do not renumber migration 0009 or alter existing migrations. Keep any production portfolio schema separate from the prototype snapshot. Define retention and cleanup for operation/event records; retain financial references needed for reconciliation. Prefer event references and minimal metadata over retaining raw webhook bodies and unnecessary personal information.

Stripe is authoritative for billing and payment outcomes. D1 supplies indexed read models, application permissions, drafts, intent records, and sync state. Invoice, subscription, payment, and connection status remain separate: an active subscription does not prove every invoice has been paid. A payment failure does not automatically suspend a website, revoke admin login, delete records, or disable billing access.

## Subscriptions and changes

Start with fixed recurring prices, monthly and annual intervals, and optional quantities. Support a negotiated customer price by creating a new immutable price reference and explicitly assigning it. Changing a catalog price must not change every existing subscription. Usage metering, complex installment schedules, and marketplace payouts are separate additions.

Create a subscription offer for a known customer and collect payment through a customer-bound hosted Checkout session. Use approved prices and quantities resolved server-side. Prevent duplicate active offers and repeated submissions from creating duplicate subscriptions. An existing saved payment method is not blanket permission to collect unrelated charges.

Before an admin changes a subscription, show the existing and new price, effective date, next renewal, estimated tax, and any charge or credit. Default routine changes to the next renewal. Offer immediate changes only through an explicit Stripe proration preview and confirmation. Bind confirmation to the current subscription, requested change, and preview; reject stale previews. Preserve the subscription item ID and quantity when replacing a price. Handle authentication requirements and failed immediate payments without presenting the requested plan as paid. Stripe supports [price changes and subscription schedules](https://docs.stripe.com/billing/subscriptions/change-price) and [proration previews](https://docs.stripe.com/billing/subscriptions/prorations).

Customer plan changes use only the seller's approved catalog and portal configuration. Default customer cancellation to the end of the paid period and show the effective date. Allow reversal before cancellation takes effect where supported. Seller cancellation must show its billing effect; cancellation does not imply a refund. Model scheduled changes distinctly from effective changes. Special negotiated or unsupported subscriptions show their actual details and a clear contact path rather than an invalid self-service action.

## One-off payments and invoices

Support two initial flows: an itemized invoice for services already agreed with the customer, and an immediate one-off purchase using hosted Checkout. The invoice flow is Draft → Preview → Finalize and send → Awaiting payment → Paid, with overdue, void, and uncollectible states where applicable. Stripe invoices move from draft to open on finalization and restrict subsequent edits; preserve that boundary in the editor. See [Stripe invoice lifecycle](https://docs.stripe.com/invoicing/overview).

The editor includes the customer, billing details, line descriptions, quantities, unit amounts, currency, due date, memo, and applicable tax/discount settings. Default collection to an emailed/hosted invoice that the customer pays. Off-session charging requires an explicitly selected collection method and appropriate customer authorization. Saving a draft must not finalize, send, or charge it. Sending, finalizing, and retrying payment are distinct audited actions with a final amount preview.

Attach draft line items to the intended invoice, not a customer's unassigned pending items that could land on a subscription renewal. Checkout payment success must be verified server-side and through payment events, including asynchronous methods. Show a receipt for a Checkout payment and an invoice where one was actually created; do not label every payment document an invoice. Keep paid invoices immutable in the harness. First-release refund and credit-note actions can link to Stripe, with resulting changes synchronized back into billing history; richer native correction workflows can follow.

For the initial live pilot, choose an explicit currency and the business's invoice/tax settings. Do not silently enable Stripe Tax, paid add-ons, tax rates, discounts, or automated off-session collection. Treat collected revenue, expected recurring value, outstanding balance, fees, taxes, and refunds as distinct measures.

## Billing in a separate client admin

Pair each paying client's existing admin installation with the seller through an explicit customer-scoped grant. Pin the seller origin and installation identity plus the client's installation ID, site ID, and exact admin origin. Verify ownership during pairing and store the caller credential only as a secret on the client Worker and a digest at the seller. A client label, supplied customer ID, email change, or browser URL cannot change this mapping.

The client browser talks only to its own authenticated admin. That Worker checks the active user and local billing permissions, resolves its configured grant, and requests only its mapped customer's billing data from the seller. The seller rechecks the grant, module enablement, scope, and object ownership. Grant rotation and revocation take effect without modifying either installation's users. Use a fixed approved seller origin, reject redirects, bound responses, enforce timeouts, and reject private-network destinations in production.

For payment changes, plan changes, and cancellations, create a fresh Stripe portal session server-side after both installations authorize the request. Resolve the Stripe customer from the grant, never a browser parameter. Select an approved portal configuration and exact registered return origin. Portal access can expose that Stripe customer's billing history, so only pair installations/users allowed to see the full customer account. If one client owns several websites, agree which admins may access the shared business bill; do not infer this from website access alone. Stripe supports [customer portal configuration and action links](https://docs.stripe.com/customer-management).

Grant lookup and portal URL generation must fail closed when disconnected or revoked. Invoice/PDF links and portal sessions are sensitive; return them only after authorization with no-store responses, do not log or persist reusable portal URLs, and validate provider link destinations. Show last successful sync and unavailable/stale status honestly. Revoking a grant hides retained billing data from that client and stops further reads.

## Permissions and routes

Introduce explicit capabilities such as `billing:read`, `billing:customers:write`, `billing:catalog:write`, `billing:subscriptions:write`, `billing:invoices:write`, `billing:collect`, `billing:connection:manage`, `account-billing:read`, and `account-billing:manage`. Separate local role capabilities from customer/account grants. Begin with owner access, deny other roles unless deliberately granted, and test both module types. Ownership of a client installation never grants seller privileges in another installation.

| Route family | Authentication and behavior |
| --- | --- |
| `/api/modules/billing/...` | Seller browser session, exact mutation Origin, module enablement, action permission, scoped customer/object checks. Customers, catalog, subscriptions, previews, invoices, payments, sync health, and connection readiness. |
| `/api/modules/account-billing/...` | Client browser session, exact mutation Origin, module enablement, local billing grant. Read own summary/history and request portal/checkout actions through the configured seller. |
| `/api/billing/v1/customer/...` | Separate machine credential and customer-scoped grant; no browser session bypass on module routes. Fixed read and session-creation operations, with rate limits and audit metadata. |
| `/api/billing/stripe/webhook` | Exact seller host, enabled/configured seller module, raw-body Stripe signature and timestamp validation, verified account/mode, bounded payload, and durable receipt. No browser session or browser Origin requirement. |

Define typed contracts, error categories, pagination, allowed filters, rate limits, and required permissions before implementing endpoints. Return not-found for out-of-scope IDs. Permission checks and grant validation occur on every operation. Customer invoice access must constrain both the invoice and its customer before generating document links.

## Reliable writes and synchronization

Persist a scoped operation intent before a Stripe mutation and reuse its idempotency key for safe retries. Reject reuse with a different payload. A timeout after Stripe accepts a request becomes Pending verification, with reconciliation using the original operation/object identity. D1 and Stripe do not share a transaction; never roll back by blindly creating a replacement subscription or charge. Keep durable results beyond Stripe's idempotency retention and reconcile old uncertain operations before retrying. See [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

Verify webhooks using the original request bytes. Deduplicate using account, mode, and event ID, then commit receipt and durable processing work before returning success. Claim work with atomic leases and make processing repeatable. Duplicate delivery must not cause duplicate financial actions. Events may arrive late or out of order, so reconcile the current Stripe object state rather than blindly applying event payloads in arrival order. Never mark payment successful from a success redirect.

Handle Checkout completion/expiration and asynchronous payment outcomes, subscription creation/update/deletion, invoice creation/finalization/payment/failure/void/uncollectible changes, and payment/refund changes needed for the read model. Scope incoming events to known customer links; unrelated account customers must not appear automatically in the harness. Flag unknown IDs for reviewed linking instead of adopting them from untrusted metadata. Import existing customers/subscriptions through an explicit preview and linking flow that creates no financial objects and charges nothing.

Implement bounded retry/backoff, a visible failed-work list, manual reconciliation, and periodic recovery for missed webhooks. Inventory the actual installation's existing scheduled handler and available cron capacity. Reuse a deliberately configured scheduler where appropriate; add a Queue or schedule only through an explicit installation diff. A crash after receipt must leave durable work recoverable without relying on waitUntil alone. Stripe describes [subscription events](https://docs.stripe.com/billing/subscriptions/webhooks) and [webhook verification and delivery](https://docs.stripe.com/webhooks).

## Execution sequence

1. **Product and contract design.** Confirm the initial seller installation and pilot client, starting currency, existing Stripe records to link, initial plans/services, cancellation timing, and invoice collection settings. Freeze the two module contracts, identity relationships, permission matrix, and setup flow. Deliver screen states and the installation/resource diff without production changes.
2. **Local interface prototype.** Build synthetic seller overview, customer detail, subscription change preview, invoice editor, and client Your billing screens. Include overdue invoices, a failed payment, a scheduled cancellation, multiple websites for one customer, and a disconnected seller. Review desktop/mobile flows. Keep the prototype explicitly synthetic and unable to charge or send.
3. **Foundation and isolation.** Implement additive migrations, typed contracts, module registration, permissions, durable billing customers, optional production portfolio identity/linking, and a fake Stripe adapter. Prove ordinary installations stay unaffected and both seller/client data isolation work before adding external access.
4. **Stripe sandbox and subscriptions.** Verify account identity, configure hosted Checkout and portal, implement operation journaling, webhook inbox/recovery, catalog and subscription creation/change/cancellation. Exercise actual sandbox renewals and payment failures. Keep live keys absent.
5. **Invoices and one-off collection.** Implement draft/preview/finalize/send, hosted payment, one-off Checkout, document links, payment/refund synchronization, and read-only import/linking. Test that draft edits and repeated actions never collect payment unintentionally.
6. **Client installation pairing.** Add revocable customer-scoped grants, machine routes, local role/grant checks, and Your billing. Verify the complete path between two isolated installations, including portal return, plan change, cancellation, account revocation, and supplier outage. Add Clients billing summaries using the same billing service.
7. **Release verification.** Run `npm run check`; exercise browser workflows at desktop and phone sizes; build and install packed packages outside this workspace. Verify seller-only, client-only, both-modules, and neither-module configurations with the actual Workers runtime and packed declarations/assets.
8. **Private pilot and rollout.** Prepare reviewed per-installation manifests, Worker secrets, exact origins, schema backup/migration steps, webhook configuration, scheduler changes, supported package versions, recovery instructions, and screenshots/results. Deploy only to the designated seller and pilot client after release review and authorization. Verify real authenticated permissions and sync on canonical hosts. Any live charge or customer notification uses an explicitly authorized pilot action. Roll out other businesses independently.

## Acceptance and recovery

Release requires tests for unauthenticated/disabled/unauthorized module routes, wrong hosts and Origins, foreign customer/invoice/subscription IDs, wrong Stripe account/mode, revoked grants, malformed payloads, malicious return URLs, and secrets absent from bundles/logs/package contents. Verify the migration from the previous supported schema preserves users and records.

Financial acceptance covers successful and failed signup, extra authentication, renewal failure/recovery, plan changes with and without prorations, outstanding invoices during a plan change, cancellation timing, duplicate Checkout requests, draft isolation, invoice sending, one-off payments, refunds, stale previews, concurrent edits, Stripe timeout after success, duplicate/out-of-order/missing events, and a worker crash after durable receipt. Stripe's [sandbox billing tests and test clocks](https://docs.stripe.com/billing/testing) support lifecycle verification.

Client acceptance proves one client cannot list or access another customer's data, documents, or portal. Removed local users lose access immediately; grant revocation and module disablement stop machine requests and new sessions. Disabling a harness module or disconnecting Stripe does not cancel existing Stripe subscriptions: show that consequence explicitly before disconnect and provide the seller's reconciliation/cancellation path.

Recovery procedures cover pausing new mutations, retaining webhook receipt/recovery where needed, rotating secrets, inspecting uncertain operations, reconciling Stripe state, and restoring application service. A code rollback or D1 backup restore never reverses a real payment or cancellation. Retain the audit trail and reconcile provider state before resuming collection. Do not automatically suspend websites or remove clients' ability to pay because a subscription is overdue.

The first release is complete when a seller can connect its own account, create a subscription and an itemized one-off invoice, track accurate payment states, and a separately authenticated client can view/pay their own invoices and use approved self-service subscription actions. The same packed module must work in another independent business installation without sharing credentials, customers, or backend resources.
