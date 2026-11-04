# Preview unsaved onboarding templates

Add Preview changes inside the optional Vitris template editor. Keep its controlled draft in an in-memory React provider scoped to the signed-in client-onboarding module. A full-page preview uses the actual shared client journey, including edited welcome copy, questions, sections, and optional payment setup. Back to editing and browser back restore the same draft. Reset preview affects example answers only. New templates can be previewed before their first save.

The draft is never serialized into a URL, browser storage, or an API mutation. The existing save endpoint retains its revision checks and remains the only way to persist edits. Leaving the module, signing out, or reloading discards the local draft; reopening a draft-preview URL shows an explanatory empty state. Disabled and unauthorized installations retain the existing module gates. No backend routes, permissions, migrations, services, remote data changes, or deployment are required.

Verify unsaved versus stored definitions, edit/preview/return cycles, browser back, reset isolation, save-after-preview, empty new templates, missing drafts, desktop/phone/mobile layout, and access gates. Run npm run check with packed-package acceptance. Keep the existing local preview running for user testing.

## Implemented

Preview changes is available at the top and bottom of the editor. Its full-page route reads the controlled template draft directly from the module-scoped provider and reuses the existing preview journey. A separate Unsaved changes note and Back to editing button distinguish it from saved-template previews. Draft fields and revision survive preview/return and browser Back. Preview answer resets do not alter the template draft. Empty new templates use an Untitled template label and do not require a save to preview. Only the existing Save template action persists definitions.

Two focused draft-preview browser scenarios pass, as do all five existing preview/onboarding scenarios. They verify edited welcome/headline/introduction, question labels/hints/formats/required flags/sections, omitted stages, phone and 390px layout, account simulation, no API mutations or new prospects, unchanged saved revision before save, exactly one subsequent template save, new incomplete templates, missing drafts after reload, and leaving the module. Existing unauthorized/disabled checks also cover the draft-preview route.

The real local browser was signed in through the normal private owner link, used to customize an existing starter without saving, opened on both widths, returned to confirm the headline draft, and left in the desktop preview with its draft intact. Screenshots are in ignored artifacts/template-draft-preview/desktop-live.jpg and phone-live.jpg. No invitation, client account, email, payment, remote migration or deployment was created.

The first full check encountered a concurrently introduced JSON response typing error in the shared Leads helper. A minimal unknown-value guard/cast, matching the existing core request helper, corrects it without changing Leads behavior. A subsequent build briefly encountered a typography stylesheet while concurrent work was creating it; the complete file is now available. Build and strict TypeScript pass with both changes present. Full-suite results follow below.

Final verification (November 4, 2026): npm run check passed cleanly: build, strict TypeScript, all 187 tests, both suites, zero failures/skips. This includes the external packed admin installation and paired website/admin booking acceptance. Evidence: artifacts/template-draft-check-final.log. The existing local server remains running on port 4393; no local records were reset.
