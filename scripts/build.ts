import process from 'node:process';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir, copyFile, readFile, writeFile} from 'node:fs/promises';
await mkdir('packages/contracts/dist', {recursive: true});
for(const name of ['admin','contracts','create-admin']) await copyFile('LICENSE',`packages/${name}/LICENSE`);
// Keep the root and scheduling entry points on one module identity (including validation errors).
await build({entryPoints: ['packages/contracts/src/index.ts'], outfile: 'packages/contracts/dist/index.js', bundle: false, format: 'esm', platform: 'neutral'});
await writeFile('packages/contracts/dist/index.js', (await readFile('packages/contracts/dist/index.js', 'utf8')).replaceAll('./scheduling.ts', './scheduling.js'));
await build({entryPoints: ['packages/contracts/src/scheduling.ts'], outfile: 'packages/contracts/dist/scheduling.js', bundle: true, format: 'esm', platform: 'neutral'});
const {spawnSync} = await import('node:child_process');
const declaration = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', 'packages/contracts/src/index.ts', '--declaration', '--emitDeclarationOnly', '--outDir', 'packages/contracts/dist', '--target', 'ES2022', '--moduleResolution', 'bundler', '--module', 'esnext', '--allowImportingTsExtensions', '--strict', '--skipLibCheck'], {stdio: 'inherit'});
if (declaration.status !== 0) throw declaration.error || new Error('Contract declaration build failed');
await writeFile('packages/contracts/dist/index.d.ts', (await readFile('packages/contracts/dist/index.d.ts', 'utf8')).replaceAll('./scheduling.ts', './scheduling.js'));
await build({entryPoints: ['packages/admin/src/worker.ts'], outfile: 'packages/admin/dist/worker.js', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022'});
const workerDeclarations = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', 'packages/admin/src/worker.ts', 'packages/admin/bin/admin.ts', '--declaration', '--emitDeclarationOnly', '--outDir', 'packages/admin/dist/types', '--target', 'ES2022', '--moduleResolution', 'bundler', '--module', 'esnext', '--allowImportingTsExtensions', '--types', '@cloudflare/workers-types,node', '--strict', '--skipLibCheck'], {stdio:'inherit'});
if(workerDeclarations.status !== 0) throw workerDeclarations.error || new Error('Worker and CLI declaration build failed');
await copyFile('packages/admin/dist/types/admin/src/worker.d.ts','packages/admin/dist/worker.d.ts');
await mkdir('packages/admin/dist/contracts',{recursive:true});
await copyFile('packages/contracts/dist/index.d.ts','packages/admin/dist/contracts/index.d.ts');
await copyFile('packages/contracts/dist/scheduling.d.ts','packages/admin/dist/contracts/scheduling.d.ts');
await writeFile('packages/admin/dist/worker.d.ts',(await readFile('packages/admin/dist/worker.d.ts','utf8')).replace('../../contracts/src/index.ts','./contracts/index.js'));
await copyFile('packages/admin/dist/types/admin/src/harness.d.ts','packages/admin/dist/harness.d.ts');
await writeFile('packages/admin/dist/harness.d.ts',(await readFile('packages/admin/dist/harness.d.ts','utf8')).replace('../../contracts/src/index.ts','./contracts/index.js'));
await writeFile('packages/admin/dist/worker.d.ts',(await readFile('packages/admin/dist/worker.d.ts','utf8')).replace('./harness.ts','./harness.js'));
await copyFile('packages/admin/dist/types/admin/src/scheduling/calendars/types.d.ts', 'packages/admin/dist/calendar.d.ts');
await writeFile('packages/admin/dist/calendar.d.ts', (await readFile('packages/admin/dist/calendar.d.ts', 'utf8')).replace('../../../../contracts/src/scheduling.ts', './contracts/scheduling.js'));
await writeFile('packages/admin/dist/worker.d.ts', (await readFile('packages/admin/dist/worker.d.ts', 'utf8')).replace('./scheduling/calendars/types.ts', './calendar.js'));
await copyFile('packages/admin/dist/types/admin/src/scheduling/booking-env.d.ts', 'packages/admin/dist/booking.d.ts');
await writeFile('packages/admin/dist/worker.d.ts', (await readFile('packages/admin/dist/worker.d.ts', 'utf8')).replace('./scheduling/booking-env.ts', './booking.js'));
await viteBuild({root: 'packages/admin/ui', base: '/', build: {outDir: '../dist/client', emptyOutDir: true}});

// npm executes compiled JavaScript; all maintained entry-point sources are TypeScript.
for (const name of ['admin', 'setup']) {
  await build({entryPoints: [`packages/admin/bin/${name}.ts`], outfile: `packages/admin/bin/${name}.mjs`, bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24'});
}
await copyFile('packages/admin/dist/types/admin/bin/admin.d.ts', 'packages/admin/bin/admin.d.mts');
await build({entryPoints: ['packages/create-admin/index.ts'], outfile: 'packages/create-admin/index.mjs', bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24'});
