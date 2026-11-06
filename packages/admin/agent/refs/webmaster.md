# Managed by Webmaster

`webmaster` is a built-in, opt-in connection shown under **Settings**, not a new navigation section. It can identify any webmaster organization; no billing service or central webmaster account is required. A person uses their own account in the client's existing installation. This connection does not authorize website publishing, content editing, provisioning, ownership transfer or access to other installations.

## Installation diff

Read WORKFLOW.md, both Worker entry points, manifests, account setup and the existing backend/form configuration. Add `webmaster` to the intended manifest's `modules` list; no extension import or scaffold is needed. The runtime must include the new built-in support. Preserve all existing entries, exact origins, accounts, modules, secrets and backend grants. The same connection works through the explicit Pages adapter without changing hosting or mail.

The additive core migration `0011_webmaster_connections.sql` creates connection, persistent membership restriction and attribution tables. It does not rewrite users, credentials, leads, form configuration or applied migrations. Back up an existing owning D1 database and apply locally before a separately authorized remote application. No new Cloudflare binding, external API or paid service is required. Package upgrades do not enable the connection.

Sign in as the client account owner. Invite each webmaster team member as an **editor or analyst** using the installation's normal account workflow, or choose an existing active account with one of those roles. Then open **Settings → Managed by Webmaster → Connect a webmaster**. Enter a stable organization ID and its display name, select the named members and their agreed permissions, and explicitly save. Owners and administrators cannot be managed members; don't downgrade an owner's account to work around this boundary. Selected member accounts use the connection's capabilities instead of their ordinary role capabilities. Choose separate accounts for people who also need an independent owner or administrator identity.

The initial operational vocabulary is intentionally narrow:

| Capability | Access |
| --- | --- |
| `analytics:read` | Website analytics |
| `settings:write` | Existing notification preference settings; does not change live email delivery |
| `tasks:read`, `tasks:write` | Work queue; writes require read access |
| `leads:read`, `leads:write` | Optional lead access; writes require read access |

There are no default lead grants. Connection inspection is available to signed-in client users under Settings; only owners can edit or disconnect it. Other users see the agreed aggregate scope and their own membership, not the team's account list. Billing, access administration, activity-history access, scheduling/calendar management and ownership are excluded from these grants. Scheduling has a separate resource/grant model and requires a separately reviewed future extension. Module authors must keep using `context.require` for finer write permissions; never infer managed access from `user.role`. `userCan(user, permission)` reflects the resolved scope for display and ordinary permission decisions. The Worker resolves membership server-side, not from browser declarations.

## Optional billing

Leave **This organization also provides our billing** unchecked for a management-only relationship. That flag records the owner's identification of the billing provider; it creates no customer, charge, token, subscription or billing pairing. Do not fabricate a billing account for a free managed site.

For paid sites, separately follow `refs/billing.md` to install `createBillingAccount` as `account-billing` with the reviewed seller identity, customer grant and private machine token. **Your billing** supplies subscriptions, invoices, payment history, document links and hosted payment management. Webmaster access never grants seller billing or client payment-management capabilities. An enabled client billing module and its credentials remain independent of the management relationship. The label does not automatically verify or replace the configured seller identity; review both identities in the installation diff.

## Revocation, activity and recovery

Authenticated GET `/api/modules/webmaster` inspects the relationship. Owner-only POST to that route writes `{organizationId,organizationName,billingProvider,members:[{userId,permissions}],revision}`. Updates require the current revision, with `0` for first creation. Concurrent edits return 409 without partially rewriting grants or auditing a rejected action. Owner-only POST `/api/modules/webmaster/disconnect` requires `{revision,acknowledgeSubscription:true}`. The UI explains the effect before enabling that control.

Disconnecting immediately blocks all managed accounts and deletes their sessions and unused legacy login links. Removing a member also deletes that member's sessions/links. Reconnecting requires fresh sign-in for disconnected members. Revocation does not deactivate or delete the person's existing user, password or records. Restrictions persist after disconnection, membership removal, organization changes or module disablement, so an old editor/analyst role never silently restores access. A managed identity is restricted to the installation, site and exact admin origin that grant it access. To restore management, the owner must explicitly save that member's new grants. Ordinary account deactivation remains available through the owning installation's account lifecycle.

Disconnecting management access, disabling the module or removing a billing grant **does not cancel an existing subscription or stop future charges**. Cancellation is separate through the billing provider's reviewed policy. The disconnect handler makes no provider request and never invokes billing cancellation.

Managed operations store the person's ID/email and a snapshot of the responsible webmaster organization in Activity. Later renames and disconnects do not rewrite prior attribution. Core actions with new attribution are scoped to the owning installation/site/origin; older owning-database activity remains readable. Keep each installation's database separate as usual.

Run `npm run check`, exercise both enabled/disabled states and consume packed packages outside the workspace. Test no-billing and separately paired billing variants. Review membership restrictions, migration effects and backup/rollback before deployment. Keep restriction rows. Before reverting to a runtime predating this access model, deactivate managed users and revoke their sessions/links; an older runtime cannot enforce the new restrictions. A code or database rollback does not reverse payments or cancel subscriptions. No installation is deployed or remotely migrated by updating this kit.

## Optional organization reporting

Version 1.2.0 supports explicit client-owner-approved analytics pairing through a reporting proxy. Follow `refs/reporting-pairing.md` for its optional migration, trusted installation configuration, secrets, wire contract and recovery. This organization machine grant survives removal of a human member. Disconnecting/changing the organization or revoking the reporting grant invalidates it permanently; reconnecting requires fresh pairing. Billing stays separate.
