# Cloudflare business admin roadmap

## Local foundation

Implemented: package workspace, Cloudflare runtime, business-branded local shell, synthetic data, D1-backed lead statuses/settings/tasks/activity, permission checks, login-token implementation, module handler registration, agent kit, installation scaffolder, and public website connection plan/apply.

## Connect the harness

Implemented: harness `admin setup|status|verify`, a scoped backend v1 API, the admin read adapter and optional lead-status writes, grant templates containing credential hashes, connection identity verification, backend error states and cross-package D1 verification. Existing form IDs, exact origins and outbox history stay authoritative. No second notification pipeline is created. Next: automate reviewed resource reconciliation, rotation and deployment, and connect the first business after its collection/domain prerequisites are resolved.

## Production access and provisioning

Add verified invitations, member management, manager delegation, ownership transfer, email delivery telemetry, retained audit events, atomic mutation/audit transactions and hardened distributed login abuse controls. Confirm Cloudflare Email Service account availability and sender restrictions. Add plan/apply resource reconciliation with operation IDs, no duplicate allocations, and explicit account/domain ownership checks.

## Business modules

Add contract version negotiation and a bounded module API/UI SDK. Extend data visualization through compiled modules. Add migration planning, upgrades of copied UI and kit files, module version checks, and real custom-module acceptance tests. Preserve business data when disabling a module.

## Portability and pilot

Implement full export/import, tested restoration into a different account, backup retention controls, release evidence and upgrade recovery. Pilot on one consenting business after verifying two independent installations. Publish npm and source releases after package and security review.

Pages and Media editors, drag-and-drop layout editing and arbitrary HTML editing are excluded. Content/media updates will be designed as a separate AI workflow. The agency dashboard is a future application using explicit delegated grants.
