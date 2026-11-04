# Cloudflare deployment

Use dedicated Workers, D1 and R2 resources for each business installation. Deploy the UI assets and API together, on the canonical `admin.business.com` HTTPS origin. Unknown hosts are rejected, including provider preview hostnames. `workers_dev` is disabled by default.

Create a D1 database and R2 bucket in the authorized account. Replace placeholder resource bindings in `wrangler.jsonc`. The default Custom Domain path requires the domain zone to be active in that account. Provisioning across accounts or external DNS needs a separate reviewed hostname strategy; a CNAME alone is not the default contract.

Use `npx wrangler d1 create NAME` and `npx wrangler r2 bucket create NAME` only after reviewing the account and planned names. Back up existing D1 before remote migrations. `npx wrangler d1 migrations apply NAME --remote` changes production data; local preview uses the separate local config and `--local`.

Authentication uses Cloudflare Email Service's structured `send()` builder through an `AUTH_EMAIL` binding, with a server-configured `AUTH_FROM`. Configure a restricted authenticated sender and complete provider domain onboarding. Account sending availability and recipient restrictions must be verified before login acceptance. See https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ and https://developers.cloudflare.com/email-service/configuration/send-bindings/ . No Resend, Gmail, or other email provider is required by default.

Prepare the designated first owner with `vitris-admin owner-setup --email ADDRESS`, review `.vitris/owner-setup.sql`, then apply it to the correct dedicated D1 database after migration 0009. The owner requests their activation email at `/account/setup` and chooses their own password. Existing owners retain their account and sign in normally, then verify email under Account security. Read `accounts.md` for the shared `accounts@tryvitris.com` sender, readiness flag, secrets, queue/scheduler, and rollout/recovery instructions. The legacy `owner` command remains for old installations only. No command prints a login token or sends mail as a scaffolding side effect.

`vitris-admin plan` reports configuration prerequisites and makes no cloud changes. `doctor` checks configuration presence, not actual DNS, sender delivery, or resource ownership. Automated resource reconciliation is a later milestone. Before deployment, inspect Wrangler's dry-run output and verify package contents. Keep installation dependencies pinned and update copied UI/agent files through reviewed diffs.

Opt-in scheduling calendars require separately reviewed migration 0005, business-owned OAuth credentials, token encryption secrets and an explicit one-minute cron trigger. Preserve the returned `scheduled` handler when wrapping `createAdmin`; see `calendar-sync.md`. Do not enable or provision calendar connections as a setup side effect.

Customer scheduling emails use the separate restricted `SCHEDULING_EMAIL` structured binding, a notification encryption ring and explicit business settings. Read `customer-notifications.md` before enabling it; preserve the cron handler and validate sender/inbox acceptance separately. Local captures do not prove delivery.
