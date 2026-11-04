# Module contracts

A module is trusted source installed at build time. It declares `id`, `version`, `label`, `permission`, `description`, and an async `handle(context)` function. IDs cannot collide with core navigation or installed modules. A manifest may enable only registered IDs. Disabled IDs have no navigation or authorized API surface.

Trusted extensions may register exact POST hook paths under `/api/modules/MODULE_ID/hooks/NAME` and an optional scheduled handler. Hook paths must be unique and stay within the owning module namespace. Runtime checks the canonical host, explicit registration and enablement before invoking a hook; the handler must implement its own provider/machine authentication. This exception does not remove browser session or Origin checks from ordinary module routes. Hook functions and scheduler implementations are excluded from public bootstrap metadata. Preserve the returned scheduled handler in installation wrappers.

The optional Stripe module is supplied by `@tryvitris/website-admin-harness/billing`; read `refs/billing.md` before registering it or changing its records, hooks, setup, recovery or client connections. The `/prototypes/billing` export remains a separate local-only simulation.

The Worker routes `/api/modules/MODULE_ID` and its child paths to the module only after checking the canonical host, session, Origin on mutations, manifest enablement, and declared permission. The handler receives `request`, `env`, `manifest`, `user`, `require(permission)`, and `audit(action)`. Use `require` for each action's finer permission; the baseline read permission alone must never authorize writes.

The current capability vocabulary is intentionally small. Add a new capability to contracts and the role mapping with tests when a new business task requires it; do not reuse an unrelated capability to gain access. Agent-generated scaffolds default to read-only until their permissions and schema are reviewed.

Return JSON with `{rows: [...]}` for the built-in list renderer. Each row has a stable `id` and a human-readable `title` or `name`. The Work queue example has a dedicated interface, an additive migration, and separate read/write capabilities. More elaborate visualizations are compiled into the UI package through source changes.

Filter records by `manifest.site.id`. Bind SQL parameters. Bound request bodies and validate all writable fields in the handler. Do not log tokens, form contents, customer email bodies, or raw network addresses. Generic modules are trusted code, not a security sandbox; installing source grants access to the installation's bindings.

New module scaffolds use `modules/<slug>/index.ts` with `satisfies AdminModule`. Import that TypeScript definition into `worker.ts` and `worker.local.ts`. Run `npm run check` in the installation to verify both Workers and all module sources. Preserve existing installation entry points during upgrades; the initializer only writes new installations.

`scheduling` is a built-in optional module. Do not scaffold or register an extension with that ID. Read `refs/scheduling.md` before enabling it or changing its contracts, schema, permissions or reservation rules. It currently accepts test appointments and captures jobs; it does not enable public booking. Opt-in Google/Outlook sync requires the separate setup in `calendar-sync.md`; test appointments write to enabled calendars.
