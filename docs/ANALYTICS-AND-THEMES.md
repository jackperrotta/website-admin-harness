# Analytics and website theme integration

The packaged Analytics section includes Traffic & audience, Engagement, and Enquiries & actions. It reads the installation's existing `/api/analytics?days=14|30` route under `analytics:read`. There is no new tracking script, provider, permission, Cloudflare binding or migration.

The website backend's existing admin v1 analytics endpoint now returns these optional daily fields in addition to `day`, `views`, `visitors` and `enquiries`:

- `sessions`, `bounces`, `engaged`, `duration_ms`, `leave_count`;
- `scroll_25`, `scroll_50`, `scroll_75`, `scroll_100`;
- `converts_form`, `converts_tel`, `converts_mailto`, `converts_maps`;
- `engage_nav`, `engage_btn`, `engage_img`, `engage_carousel`;
- JSON arrays of `{key,n}` in `top_paths_json`, `top_refs_json`, `channels_json`, `devices_json`, `hours_json`, `top_engage_json`;
- `previousRows` for the preceding matching period.

Historical data comes from existing daily rollups. Today is calculated from live events without rewriting those rollups. All queries constrain the granted tenant; preview events and isolated test forms remain excluded. Hourly data retains all 24 buckets. Day-level visitors and sessions are summed, not deduplicated over the period. Average time uses total duration divided by recorded exits; scroll percentages use recorded exits. Phone/email/directions clicks are actions rather than completed sales. Top-page and label rankings retain the limits of the backend's existing daily top lists.

Older v1 backends remain usable. Missing fields display as unavailable, and detailed tabs are disabled until the backend supplies their data. No local synthetic records replace a connected request failure. Comparisons require complete matching day counts and a nonzero previous total; missing history does not become a fabricated zero-percent change.

## Website colors

The existing server-to-server status response includes `theme`, containing only validated `colorBg`, `colorText`, `colorMuted`, `colorAccent`, `colorAccentText`, `colorSurface`, `colorSurface2`, `colorBorder` and `colorFocus` values. The backend reads the tenant's published `sites/<slug>/theme.css` in its existing R2 bucket, then falls back to its tenant-scoped stored theme. Arbitrary CSS, fonts, URLs, credentials and theme editor controls are not passed through.

Bootstrap applies those colors to login, navigation, panels, text, borders, controls and charts. An optional manifest `theme` with the same validated keys supports an installation fallback; a neutral palette is used when website colors cannot be loaded. Dark hex backgrounds select dark native control appearance. Theme lookup failures do not create a development authentication path.

A dedicated data-only backend for a separately hosted Pages website can set its existing `ASSETS_ORIGIN` variable to that website's exact HTTPS origin. When R2 has no published theme, status reads only `/theme.css` at that origin and only when it exactly matches the authenticated installation grant. Requests carry no credentials/cookies, refuse redirects, have a three-second timeout and a 64 KiB streaming limit, and return only validated color literals. No website records are rewritten to synchronize a palette.

## Release and installation diff

The admin source change is in `packages/contracts/src/index.ts`, `packages/admin/src/{harness,worker}.ts`, and `packages/admin/ui/src/`. The companion backend change is in `vitris-v3/src/worker/{admin-api,admin-analytics}.ts`. No installation configuration, owner accounts, exact origins, grants, forms, database records, or migrations are changed.

Deploying the admin package alone supports basic existing connections; the additional charts and automatic published theme colors require the companion backend revision. Review that backend deployment separately against its intended environment: never roll out a shared backend or apply migrations as a side effect of installing this admin UI. Keep each business installation's existing manifest, users, dedicated bindings, hostnames and secret grants. Do not rerun setup over an existing installation to obtain these changes.

Validation uses the full admin `npm run check` (including installation from packed packages outside the workspace), backend typechecking and scoped admin API tests. Local integration acceptance exercises actual tracker events through the backend and admin adapters. No customer notifications are sent. Recovery is to restore the preceding admin/backend build; this change adds no schema state to reverse.
