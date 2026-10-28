# Agent workflow for business admin changes

The admin is a Cloudflare application with an explicit installation manifest and trusted modules. A website agent can extend this backend through this workflow. Runtime does not execute arbitrary agent prompts or shell commands.

1. Inspect `admin.config.json`, Worker entry points, enabled module IDs, current migrations, and the public website's `launch.json.admin` connection. Inspect the module source before changing it. Confirm which installation and environment own each resource.
2. Describe the business task, required records, exact permissions, routes, and any new Cloudflare bindings. Store a short plan in `agent/changes/`. Keep Pages and Media outside the initial admin scope.
3. Add trusted module source with `vitris-admin module --slug MODULE_ID --name "Module name"`. Define its version, minimum read permission, and explicit permission checks for writes. Import it into both Worker entry points and pass it in `createAdmin(config, {modules: [...]})`. Enable its ID explicitly in each intended manifest.
4. Add a new numbered D1 migration for schema changes. Preserve data and existing migration files. Every business record query must constrain the manifest's site ID, and every action must enforce permissions server-side. Never trust IDs or role declarations from the browser.
5. Implement meaningful empty, loading, success, and error states. The built-in table renderer supports simple custom-module records with a title or name. Extend the packaged React UI for richer modules; never load runtime remote scripts.
6. Run package checks and exercise the module locally. Test unauthorized and disabled-module access, cross-site record IDs, invalid input, and migration from the previous supported schema. Verify desktop and mobile behavior.
7. Produce a release and installation diff. Review new permissions, resource bindings, migration effects, and backup/recovery instructions before deployment. Keep website builds and releases behind the harness's existing verification gates.
8. After an authorized deployment, verify the canonical admin domain, real authenticated permissions, module status, and stored records. Record the deployed revision. Never send test notifications to customer recipients without authorization.

Use `refs/modules.md` for module rules and `refs/cloudflare.md` for deployment. Updating this kit requires an explicit diff; do not overwrite installation-specific instructions automatically.

Read `refs/harness.md` before changing backend connections or data adapters. A connection grants access to existing data; it does not enable website collection or send notifications automatically.
