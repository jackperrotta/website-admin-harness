# Create Website Admin Harness

Create a separate Cloudflare business admin using Node.js 24+:

```sh
npm create @tryvitris/website-admin-harness@latest -- --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://www.acme.com
```

Then run `npm install`, `npm run db:local` and `npm run dev` inside the new directory for a synthetic local demo. Production needs dedicated Cloudflare resources, domain ownership, owner bootstrap and authentication setup. See the generated agent/WORKFLOW.md. Nothing is deployed automatically.

New admins receive `npm run updates:check` and maintenance instructions through the matching runtime initializer. Existing admins use `vitris-admin updates setup --dir EXISTING_ADMIN --plan`, review, then `--apply`. Reuse an existing daily website-care task. Scaffolding never activates a scheduler or authorizes deployment.

Runtime 1.6.0 includes optional Cloudflare customer email setup and agent guidance. New installations keep email campaigns disabled; configure the business-owned sender, keys, feedback, quota, migration, and exact website connection through the reviewed setup workflow before use.
