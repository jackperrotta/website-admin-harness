# Vitris Admin runtime

Cloudflare business admin with a packaged UI, Worker runtime, D1 migrations, CLI and agent kit. Early alpha with authenticated harness leads/analytics integration; automatic resource provisioning is still pending.

Use `vitris-admin init --dir ../business-admin --slug business --name "Business" --domain admin.business.com --website https://business.com` to create a separate installation. Run its local migration and development scripts for a synthetic demo. Review its Cloudflare setup plan before configuring real resources.

Core sections: Overview, Leads, Analytics, Settings, Users and access, Activity. Add trusted business modules through the included agent workflow. Pages and Media editors are excluded.

The Worker factory is exported at `@vitris/admin/worker`. Each installation supplies a validated manifest and optional trusted module handlers. Authentication uses Cloudflare Email Service; production never displays login tokens as a mail fallback.
