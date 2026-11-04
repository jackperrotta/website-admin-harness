# Account lifecycle rollout procedure

Business deployment records belong in each installation's ignored .vitris/account-rollout/, outside the public harness repository. Preserve the private rollout record there before sanitizing public planning notes. Public instructions exclude real recipients, installation paths, resource IDs and provider receipts.

For an authorized rollout, pin and verify the package archive, export the dedicated database, rehearse the additive migration, and preserve existing users, credential rows, sessions, origins, storage and website connections. Review private mail service bindings, sender restrictions and crons without copying another installation's secrets or resources.

Keep mail readiness disabled until the business approves its sender and delivery configuration. Preserve existing DNS/MX records. Verify current secret bindings and login behavior after deployment. Send test mail only to an explicitly approved recipient, and distinguish provider acceptance from inbox receipt.

Record authorization, backup/migration/deployment receipts, provider configuration and exact recovery steps privately in the affected installation. Rollback must preserve its current dedicated database and account records; stopping mail must not change password sign-in. This procedure does not authorize deployment or changes to another business.
