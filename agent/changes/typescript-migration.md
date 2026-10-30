# TypeScript source migration

Convert authored CLI, release/build scripts, tests, and generated installations to strict TypeScript. Preserve the public compiled CLI paths and existing installation data, origins, permissions, login restrictions, and connection configuration. Add shared response contracts and replace explicit any with typed data or validated unknown values. No resource bindings, schema migrations, deployments, or cloud writes are required.

Verify the full npm run check, including fresh tarball installation outside this workspace, generated Worker and module typechecking, and local Wrangler builds. Retain compiled JavaScript only as ignored distribution output.
