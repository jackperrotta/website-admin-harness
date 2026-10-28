# Create Website Admin Harness

Create a separate Cloudflare business admin using Node.js 24+:

```sh
npm create @tryvitris/website-admin-harness@alpha -- --dir ../acme-admin --slug acme --name "Acme" --domain admin.acme.com --website https://www.acme.com
```

Then run `npm install`, `npm run db:local` and `npm run dev` inside the new directory for a synthetic local demo. Production needs dedicated Cloudflare resources, domain ownership, owner bootstrap and authentication setup. See the generated agent/WORKFLOW.md. Nothing is deployed automatically.
