# Local billing preview modules

Import `billingPrototype` and `accountBillingPrototype` from `@tryvitris/website-admin-harness/prototypes/billing`. Register only the intended module in `createAdmin(config, {modules: [...]})` and explicitly enable its ID in the local installation manifest. Both require owner permissions, explicit `MODE=local`, an exact HTTP loopback admin origin, and no configured remote website backend. They refuse production installations.

The seller module uses the optional `migrations/0001_billing_prototype.sql` in this directory. Apply it only to the dedicated local preview database, after the existing authentication schema. It adds a table scoped by installation and site, without changing existing records. This migration is deliberately excluded from ordinary installation migrations.

The client module requires a trusted local `BILLING_PREVIEW` service binding that supplies a fixed customer account from the seller. The repository's paired preview uses separate seller/client authentication databases and distinct loopback hostnames so cookies remain independent. Its adapter is a synthetic preview fixture, not production customer pairing or machine authentication. No browser parameter may select the upstream origin or customer.

All records, cards, payments, invoices, and account actions are samples. Neither module contains a Stripe adapter or email sender. Immediate price changes, real card entry, actual invoice PDFs, and production billing operations are unavailable. Sample documents download as clearly labeled text files.

From the source checkout, run `npm run billing:preview` and see `docs/BILLING-PROTOTYPE.md` for the walkthrough. The harness package includes the compiled module, declarations, optional migration, and lazy UI. Ordinary installation manifests remain unchanged and do not load billing.
