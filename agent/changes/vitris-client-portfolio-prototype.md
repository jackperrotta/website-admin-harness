# Vitris client portfolio prototype

Implement an opt-in, owner-only `client-portfolio` module registered only in `examples/vitris`. Add explicit read, request, and publish permissions, a lazy React workspace, and an additive module-specific D1 migration. Existing manifests and core migrations remain unchanged. Store synthetic client/site analytics and the simulated change lifecycle in a site-scoped snapshot with optimistic revisions. All mutations retain canonical-host, session, permission and Origin checks.

The module requires explicit local mode, an exact loopback admin origin, no remote backend, and trusted registration. It never fetches client websites, runs agents, or deploys. Its preview, runner, candidate approvals, failures, and publication receipts are explicitly simulated. Production connections and a real operator bridge remain separate implementation work.

Validate unauthorized, disabled, production, cross-site, stale-candidate, duplicate and concurrent actions; analytics coverage; desktop/mobile request-to-publish behavior; package consumption outside the workspace; and `npm run check`. No new cloud bindings, remote migrations, accounts, form configuration, or deployment are authorized by this prototype work.

Validation completed November 3, 2026: `npm run check` passed all 133 tests, including the eight dedicated portfolio server/browser tests and the external packed-package smoke test. Desktop, phone, request-dialog and candidate-review screenshots were visually inspected and are stored under ignored `artifacts/vitris-prototype/`. Browser acceptance confirms that an ordinary admin makes no portfolio requests and does not load the optional workspace chunk. See `docs/VITRIS-PROTOTYPE.md` for the walkthrough and production integration boundaries.
