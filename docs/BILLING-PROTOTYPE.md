# Local billing prototype

Run `npm run billing:preview` from the workspace. Open both previews and choose **Open local demo**:

- Business dashboard: http://127.0.0.1:4394/#billing
- Client admin: http://localhost:4395/#account-billing

The different loopback hostnames keep their login cookies separate. Both servers bind only to their exact loopback host. The client is fixed to the fictional Alder & Stone account. Every client, contact, invoice, payment, card, subscription, and account action is synthetic. No Stripe account, credential, email delivery, real card entry, remote backend, deployment, or remote migration is involved.

## Review the business dashboard

Overview shows monthly recurring value, payments collected in the last 30 days, outstanding invoices, and accounts needing attention. Annual plans are normalized for the recurring figure; payments and invoices keep their actual amounts. The six-month chart is calculated from the sample payment records.

Use Customers to inspect an account, including websites, an internal note, its subscription, and invoices. Subscriptions supports a plan change at renewal, cancellation at the end of the paid period, and keeping a subscription after a cancellation was scheduled. Plans and services shows the sample catalog. Payments separates failed attempts from successful collection.

Create an invoice, add service lines, preview the amount, and save a draft. Open the saved invoice to edit it or review and mark it sent. Drafts are not visible in the client admin. The send confirmation changes the sample invoice to awaiting payment and sends no email. Open unpaid invoices can be voided. A finalized or paid invoice cannot be edited as a draft.

Settings can pause and restore the sample connection. Pausing blocks new financial actions while preserving saved sample records and subscriptions. It does not cancel a subscription or turn off a website. Restoring the connection makes actions available again after refreshing billing.

## Review the client admin

Your billing shows only Alder & Stone, including its two websites, current subscription, next renewal, sample payment method, unpaid invoices, and invoice history. Seller-only notes, other customers, and drafts are excluded by the server.

Change the subscription plan and review the price, renewal date, and $0 due today before scheduling it. Cancel at period end, or keep the subscription to reverse that cancellation. Update payment method uses a fixed sample card and collects no card information. Open an invoice and confirm a sample payment; it records a successful payment without charging a card. Sample invoice downloads are clearly labeled plain-text documents, not Stripe PDFs.

Refresh billing in the other preview to see changes. Data survives browser refresh and resets when the preview process stops. Different browser sessions can produce revision conflicts; refresh billing before retrying. Repeated identical requests are recorded once within the bounded preview receipt history.

## Implementation boundaries

The two optional module exports live at `@tryvitris/website-admin-harness/prototypes/billing`. Example source entry points are under `examples/billing/seller` and `examples/billing/client`, and include both Worker entry points. The preview launcher uses the compiled package runtime, two independent authentication databases, and a seller-owned synthetic ledger. A fixed local service binding forwards only the client account operations to the seller. This adapter is not production machine authentication, customer pairing, Stripe checkout, a webhook receiver, or a production billing database.

The optional migration is `packages/admin/prototypes/billing/migrations/0001_billing_prototype.sql`; it is excluded from ordinary installation migrations. It adds a snapshot table scoped by installation and site without modifying existing users or records. Both modules reject non-local mode, non-HTTP/non-loopback origins, remote backend connections, and unauthorized roles. No ordinary manifest enables them automatically. Owner-only capabilities are separately named for seller and client actions.

Production work continues with normalized financial records, deliberate account setup, Stripe sandbox integration, signed webhook receipt and recovery, real hosted payment/portal flows, revocable client grants, and an independently reviewed rollout. Immediate plan changes require an actual proration preview and are unavailable here. Creating new subscriptions, native refunds/credit notes, catalog editing, tax settings, and direct one-off Checkout flows remain subsequent implementation work.

## Verification

Run `npm run check`. Coverage includes authenticated/disabled/production access, exact hosts and Origins, role revocation, client record/document isolation, draft/edit/send/pay transitions, stale and concurrent commands, duplicate request handling, plan/cancellation behavior, disconnected states, additive migration preservation, desktop/mobile browser flows, and packed-package consumption outside the workspace. Browser screenshots are written to the ignored `artifacts/billing-prototype` directory.
