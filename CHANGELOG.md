# Changelog

## 1.3.0 - 2026-11-06

- Added opt-in named webmaster sign-on for one configured broker owner, client-owner mapping to existing approved accounts, browser-bound PKCE and one-use codes, pinned signatures and live source-session checks. Vitris sign-out blocks linked client sessions; individual sign-on revocation preserves organization reporting and billing. Includes an optional additive migration and explicit installation/key/recovery guidance.

## 1.2.0 - 2026-11-06

- Added opt-in client-owner-approved analytics pairing with versioned contracts and a public server SDK, pinned installation signing keys, PKCE, short-lived approvals, hashed machine grants, encrypted retry receipts, rotation and revocation. A client-admin reporting proxy keeps original backend credentials private. Organization reporting survives individual membership removal and stops on organization disconnect. Includes optional additive migration `modules/webmaster/migrations/0012_reporting_pairing.sql`; explicit client trust, secrets and migration review are required. Billing stays independent.

## 1.1.0 — 2026-11-04

- Added an opt-in Managed by Webmaster connection in Settings, with owner-approved operational grants, optional lead access and billing-provider identification, persistent revocation and person/organization activity attribution. Management-only sites need no billing integration. Disconnecting access preserves independently configured client billing and existing subscriptions. Includes additive migration `0011_webmaster_connections.sql`; installations require an explicit module and migration review.

## 1.0.0 â€” 2026-11-04

The first stable Website Admin Harness release. The runtime, contracts and installation initializer use synchronized version 1.0.0 and npm's latest tag.

- Added optional Stripe seller billing and customer-bound client billing: subscription and one-off Checkout, invoice drafts/finalization/sending, hosted invoice/PDF access, payment history and customer portal management. Included durable operation receipts, signed webhook reconciliation, scheduled recovery, scoped permissions and an optional additive billing migration.
- Added account setup and lifecycle: designated-owner enrollment, verification, invitations, password recovery, active-account enforcement and an explicit Pages/private-mail adapter for existing installations.
- Added client-management and onboarding previews, reusable questionnaire templates, controlled draft previews, invitation flows and responsive dashboard layouts. Synthetic preview modules remain explicit and separate from production integrations.
- Expanded leads with full-history search, due/status/assignee filters, pagination, follow-up notes and concurrency checks. Existing website backends need a separately reviewed compatible upgrade for connected follow-up storage.
- Added scheduling, calendar-provider connections, booking interfaces, customer notification flows, appointment reminders and private appointment-management links with their existing test-mode and sender safeguards.
- Improved typography, mobile layouts, analytics history/date handling and dashboard consistency.
- Added publication privacy checks for working source, Git staging and actual npm archives. Business credentials, configuration, provider reports and client grants stay with each installation.
- Updated stable release tooling, registry integrity checks and fresh anonymous installation verification. Packed booking acceptance now builds a private sibling snapshot instead of cleaning shared generated output.

Existing installations require a reviewed package, copied UI/agent material and migration diff. Publishing this release does not deploy installations, enable optional modules, copy business secrets, apply remote migrations, send customer notifications or activate live payments.
