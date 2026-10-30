import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, join, dirname, relative, sep, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parseManifest, isLoopback} from '../../contracts/src/index.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFile(path, 'utf8');
const save = async (path: string, value: unknown) => {await mkdir(dirname(path), {recursive:true}); await writeFile(path, JSON.stringify(value,null,2)+'\n');};
/** Local metadata only. Never enables a module, changes a database, or contacts a provider. */
export async function schedulingConnect(options: {site?:string;dir?:string;plan?:boolean;apply?:boolean;local?:boolean;route?:string}, packageRoot: string) {
  if (!options.site || !options.dir || !!options.plan === !!options.apply) throw Error('scheduling-connect requires --site, --dir and exactly one of --plan or --apply');
  const site = resolve(options.site), admin = resolve(options.dir);
  const outside = (path: string) => path === '..' || path.startsWith('..'+sep) || isAbsolute(path);
  if (!outside(relative(site, admin)) || !outside(relative(admin, site))) throw Error('Website and admin must be separate directories');
  const manifestPath = join(admin, options.local ? 'admin.local.json' : 'admin.config.json');
  const manifestText = await read(manifestPath), manifest = parseManifest(JSON.parse(manifestText));
  if (options.local && (!isLoopback(manifest.adminOrigin) || !isLoopback(manifest.site.origin))) throw Error('Local connection requires exact loopback website and admin origins');
  if (!options.local && (isLoopback(manifest.adminOrigin) || isLoopback(manifest.site.origin))) throw Error('Loopback connections require explicit --local');
  const launchPath = join(site,'launch.json'), original = await read(launchPath), launch = JSON.parse(original) as Record<string,unknown>;
  if (launch.publicOrigin !== manifest.site.origin) throw Error('Website publicOrigin does not match the exact installation website origin');
  const existing = launch.admin as Record<string,unknown> | undefined;
  if (existing && (existing.url !== manifest.adminOrigin || existing.siteId !== manifest.site.id || existing.installationId !== manifest.installationId || existing.siteOrigin !== undefined && existing.siteOrigin !== manifest.site.origin)) throw Error('Existing admin connection differs; prepare an explicit migration');
  const route = options.route || '/book';
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(route) || ['/api','/assets','/media'].some(p=>route===p||route.startsWith(p+'/'))) throw Error('Use a safe booking route');
  const connection = {version:1,enabled:true,apiOrigin:manifest.adminOrigin,siteId:manifest.site.id,installationId:manifest.installationId,route};
  if (launch.scheduling && JSON.stringify(launch.scheduling) !== JSON.stringify(connection)) throw Error('Existing scheduling connection differs; prepare an explicit migration');
  const version = (JSON.parse(await read(join(packageRoot,'package.json'))) as {version:string}).version;
  const cliDigest = digest(await read(join(packageRoot,'bin/admin.mjs')));
  const plan = {schemaVersion:1,site,admin,manifestPath,manifestDigest:digest(manifestText),launchDigest:digest(original),version,cliDigest,connection,local:!!options.local,requirements:{mode:'test',migrationsThrough:'0006_public_booking.sql',moduleEnabled:manifest.modules.includes('scheduling'),websiteContract:1,serverFlag:'BOOKING_ENABLED=1',notifications:'captured'},cloudWrites:false};
  const planPath = join(site,'artifacts/admin/scheduling-connection-plan.json'), receiptPath = join(site,'artifacts/admin/scheduling-connection-receipt.json');
  if (options.plan) {await save(planPath,plan); console.log(`Scheduling plan saved to ${planPath}. Test mode only; no cloud writes.`); return;}
  let receipt: {planDigest:string;launchDigest:string} | undefined;
  try {receipt = JSON.parse(await read(receiptPath));} catch(error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  const preparedText = await read(planPath), prepared = JSON.parse(preparedText);
  if (receipt && receipt.planDigest === digest(preparedText) && receipt.launchDigest === digest(original) && prepared.manifestDigest === digest(manifestText) && prepared.version === version && prepared.cliDigest === cliDigest && prepared.local === !!options.local && JSON.stringify(prepared.connection) === JSON.stringify(connection)) {console.log('Scheduling connection already recorded.'); return;}
  if (JSON.stringify(prepared) !== JSON.stringify(plan)) throw Error('Scheduling plan or source changed; prepare and review a new plan');
  const backup = join(site,'artifacts/admin/launch-backups',`${digest(original)}.json`);
  await mkdir(dirname(backup),{recursive:true});
  try {await writeFile(backup,original,{flag:'wx'});} catch(error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
  if (await read(launchPath) !== original || await read(manifestPath) !== manifestText) throw Error('Connection inputs changed during apply');
  await save(launchPath,{...launch,scheduling:connection});
  await save(receiptPath,{planDigest:digest(preparedText),launchDigest:digest(await read(launchPath))});
  console.log('Public scheduling metadata recorded. Module enablement, migrations and server configuration remain explicit; no cloud writes.');
}
