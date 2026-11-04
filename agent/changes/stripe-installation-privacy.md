# Stripe installation ownership and publication safety

Keep the harness reusable and opt-in. Business credentials, billing configuration, provider reports, customer grants and deployment records belong in the owning installation's ignored private directory and production secret store. Preserve existing installations and cloud resources; this change authorizes no publication, deployment, migration or financial writes.

Relocate the private development/rollout material out of the harness checkout and retain its evidence. Preserve the original business rollout note privately and replace its public counterpart with a generic procedure. Update private runner/configuration references and the draft server-side config import. Do not include real business examples in public packages.

Require explicit installation env/config paths in the read-only Stripe verifier, with reports beside the supplied configuration rather than shared sandbox defaults. Ignore named `*.env` files in newly generated installations. Updating the package must not activate billing or adopt another installation's account, prices, customers, grants or secrets.

Add a Git publication check covering working source, untracked eligible files and staged blob contents; diagnostics withhold matched credential values. Add recognized Stripe/GitHub/private-key and private-file checks to actual release archives at pack time and again before the first publish. Keep existing exact-archive integrity validation. Review remains necessary for arbitrary business details and credential formats the detector does not recognize.

Regression checks inject a synthetic key into an actual archive, reject a private env file without any key, distinguish ignored local envs from force-added files, detect a staged key after working-copy cleanup, and reject implicit verifier paths. Run the normal check and consume packed packages outside the workspace. Audit locally reachable Git history for recognized credentials and exact known private Stripe values; retain results privately without publishing matched values.
