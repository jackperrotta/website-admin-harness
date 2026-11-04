# Recoverable private local preview sign-in

The live-analytics preview deliberately disables demo authentication and has no mail transport. Opening its plain URL currently presents an unusable email form. A one-use launcher link can also expire before the browser handoff. Fix the missing authentication affordance without adding an HTTP development-login route or loosening production/demo gates.

Expose additive sign-in readiness in bootstrap and hide the email form when no transport is configured. Explicit local private-link mode should explain how to open its owner link. Keep legacy omitted readiness compatible. Owner links should return to the requested Clients or Prospects module after confirmation. Preserve the existing token-confirmation route, one-use consumption, exact Origin/host enforcement, owner-only modules and production authentication.

Add an operator-only local IPC control to the preview process, authenticated with a random private secret stored under ignored `.vitris/`. `npm run vitris:signin` mints fresh one-use links through this control and opens the private sign-in in the default browser; the agent may use `--no-open` and the native app handoff. No browser/API endpoint can issue a token. Refreshing access must preserve local users, prospect accounts, update requests, feedback and sessions. Never print tokens or store them in public packages. Closing the preview closes the IPC control.

Validate the actual visible browser sign-in, refresh, both client modules and mobile guidance; test missing mail, legacy bootstrap, wrong control secret, one-use tokens and record preservation. Run `npm run check`, including packed installation. Keep the requested preview running. No cloud deployment, remote migration, email or Stripe action is authorized by this fix.

## Next stage after the owner's local test

1. Make prospects and onboarding progress durable, including save/resume, editable answers and reusable per-client field templates. Convert an accepted prospect into a deliberately provisioned, isolated client installation with its own admin identity and website/billing grants; do not promote local prototype credentials or sample payment status.
2. Connect the reviewed account lifecycle to real invitations, expiry/resend, account recovery and delivery status. Verify one intended recipient and the client's exact hostname before broader rollout.
3. Implement Stripe sandbox hosted payment-method setup, reconcile provider-confirmed completion, and test cancellation/retry and returning clients. Service/price agreement and charge authorization remain separate from saving a payment method. Review the owner/prospect journey before any live payment rollout.

Website update/publishing remains the existing clearly labeled simulation. A paired operator bridge and candidate-specific real release verification should follow the account/onboarding foundation.

## Verified result — November 4, 2026

`npm run check` passed with 174 tests, zero failures/cancellations/skips, including build, strict TypeScript and packed installation outside the workspace. New checks exercise wrong IPC secrets, unavailable/revoked owners, one-use tokens, preserved prospect records, disabled demo auth, unsupported email forms, expired-link recovery, same-tab replacement, module return destination, sign-out, refresh and legacy bootstrap compatibility. The recovery command was also exercised against the running preview using `npm run vitris:signin -- file-only` (a positional argument avoids PowerShell/npm flag forwarding problems).

The actual user browser tab was signed in through the fresh one-use owner link, refreshed successfully, and used to open the prospect configuration dialog and both connected sites' live analytics. It was left authenticated on Prospects & onboarding and marked as a deliverable. Screenshot: ignored `artifacts/local-preview-access/working-browser.jpg`; full check log: `artifacts/local-preview-access/check.log`. The server remains running on port 4393. No public authentication bypass, remote deployment/migration, mail delivery or Stripe request was introduced.
