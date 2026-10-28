# npm alpha release

The public package family is @tryvitris/website-admin-harness, @tryvitris/create-website-admin-harness and @tryvitris/website-admin-contracts. Versions are synchronized; the initial target is 0.1.0-alpha.1, with public access and the alpha tag. Node.js 24+ is required.

Run npm run release:pack to build, typecheck, run all tests including installation from external tarballs, audit package contents, and save reviewed tarballs plus integrity hashes to artifacts/releases/VERSION.

Run node scripts/publish-release.mjs --dry-run to inspect the exact reviewed release without publishing. Then run npm run release:publish in an interactive terminal. npm may prompt for two-factor authentication for each package; enter codes directly in that terminal. Never put authenticator codes or npm tokens in source, command arguments saved to files, or chat.

The publisher verifies every archive before publishing, publishes contracts/runtime/initializer in order, and compares registry integrity with the reviewed archive after each publication. It skips already published matching versions on retry and refuses conflicting bytes. It writes publication-receipt.json only after all three registry verifications pass. Do not republish different content under the same version.

After publication, verify a fresh npm create @tryvitris/website-admin-harness@alpha installation and local Worker build outside this workspace. Tag the Git release only after publication and registry-install verification. Customer deployments and automatic npm latest promotion are separate operations.
