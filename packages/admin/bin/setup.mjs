import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const exists=async file=>access(file).then(()=>true,()=>false);
const save=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2)+'\n');};
function origin(value,label){const url=new URL(value);if(url.origin!==value||url.protocol!=='https:')throw Error(`${label} must be an exact HTTPS origin`);return value;}

/** Local scaffolding only. Does not create resources, mutate a backend, or deploy a website. */
export async function setup(options,{packageRoot,initialize}){
  if(!options.site||!options.dir||!options.domain)throw Error('setup requires --site, --dir and --domain');
  const site=resolve(options.site),directory=resolve(options.dir),nested=relative(site,directory);
  if(!nested||(!(nested==='..'||nested.startsWith('..'+sep))&&!isAbsolute(nested)))throw Error('Admin installation must be outside the website directory');
  const launchFile=join(site,'launch.json'),original=await readFile(launchFile,'utf8'),launch=JSON.parse(original);
  const id=launch.slug;if(typeof id!=='string'||!/^[a-z][a-z0-9-]{0,50}$/.test(id))throw Error('Website launch.json needs a stable lowercase slug');
  const website=origin(options.website||launch.publicOrigin,'Website origin');
  const backend=origin(options['backend-origin']||launch.backendOrigin||launch.kernelOrigin,'Backend origin');
  const tenant=options.tenant;if(typeof tenant!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(tenant))throw Error('Provide the existing --tenant ID explicitly');
  if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(options.domain))throw Error('Use a bare admin hostname');
  const connection={schemaVersion:1,installationId:id,siteId:id,url:`https://${options.domain}`,tenantId:tenant,siteOrigin:website};
  if(launch.admin&&JSON.stringify(launch.admin)!==JSON.stringify(connection))throw Error('Another admin connection exists; plan an explicit migration');
  const scopes=['leads:read','analytics:read',...(options['lead-write']?['leads:write']:[])];
  const version=(await read(join(packageRoot,'package.json'))).version;
  const cliDigest=hash((await Promise.all(['admin.mjs','setup.mjs'].map(file=>readFile(join(packageRoot,'bin',file))))).map(bytes=>hash(bytes)).join('|'));
  const plan={schemaVersion:1,site,directory,package:'@tryvitris/website-admin-harness',version,cliDigest,launchDigest:hash(original),connection,backendOrigin:backend,name:launch.name||id,scopes,cloudWrites:false};
  const planFile=join(site,'artifacts/admin/setup-plan.json'),stateFile=join(site,'artifacts/admin/setup-state.json');
  const complete=await exists(stateFile)?await read(stateFile):null;
  if(complete?.stage==='configured'){
    const prior=await read(planFile),manifest=await read(join(directory,'admin.config.json'));
    if(complete.planDigest!==hash(JSON.stringify(prior))||complete.directory!==directory||complete.configuredLaunchDigest!==hash(original)||prior.cliDigest!==cliDigest||prior.version!==version||prior.backendOrigin!==backend||JSON.stringify(prior.scopes)!==JSON.stringify(scopes)||manifest.installationId!==id||manifest.adminOrigin!==connection.url||manifest.site?.origin!==website||manifest.backend?.tenantId!==tenant||manifest.backend?.origin!==backend)throw Error('Installation or website changed; plan an explicit migration');
    console.log('Admin installation already configured. No changes.');return;
  }
  if(!options.apply){await save(planFile,plan);console.log(`Setup plan saved to ${planFile}. Review it, then repeat with --apply. No cloud resources changed.`);return;}
  if(JSON.stringify(await read(planFile))!==JSON.stringify(plan))throw Error('Setup plan or website changed; prepare a new plan before applying');
  const token=process.env.VITRIS_ADMIN_API_TOKEN;
  if(!token||!/^[a-zA-Z0-9_-]{32,200}$/.test(token))throw Error('Set a dedicated VITRIS_ADMIN_API_TOKEN (32–200 letters, digits, hyphens or underscores) in the operator environment');
  const grant={[id]:{tenantId:tenant,siteOrigin:website,tokenHash:hash(token),scopes}};
  if(await exists(directory)){
    if(complete?.stage!=='creating'||complete.planDigest!==hash(JSON.stringify(plan))||complete.directory!==directory)throw Error('Destination exists and is not owned by this setup operation');
    const manifest=await read(join(directory,'admin.config.json'));
    if(manifest.installationId!==id||manifest.adminOrigin!==connection.url||manifest.site?.origin!==website||manifest.backend?.tenantId!==tenant||manifest.backend?.origin!==backend)throw Error('Existing installation differs from the reviewed plan');
  }else{
    await save(stateFile,{stage:'creating',directory,planDigest:hash(JSON.stringify(plan))});
    await initialize(['--dir',directory,'--slug',id,'--name',plan.name,'--domain',options.domain,'--website',website,'--backend-origin',backend,'--tenant',tenant]);
  }
  const grantFile=join(directory,'.vitris/backend-grant.json');
  if(await exists(grantFile)&&JSON.stringify(await read(grantFile))!==JSON.stringify(grant))throw Error('Existing grant differs; rotate credentials explicitly');
  // Recheck after scaffolding so concurrent website edits are never overwritten.
  if(await readFile(launchFile,'utf8')!==original)throw Error('Website changed while scaffolding; prepare a new plan');
  await save(grantFile,grant);
  await writeFile(join(directory,'BACKEND-SETUP.md'),'# Connect this installation\n\nThe backend must expose the Vitris admin v1 API. Merge the ignored .vitris/backend-grant.json into its complete ADMIN_CONNECTIONS secret map; preserve all other grants. Upload the matching VITRIS_ADMIN_API_TOKEN to this admin as HARNESS_API_TOKEN using secret stdin. No raw credential was saved.\n\nInstall dependencies; provision this installation\'s dedicated Cloudflare resources; review migrations, owner bootstrap, authentication, and DNS before deployment. This setup has not deployed resources, enabled website collection, or sent mail. Read agent/WORKFLOW.md and agent/refs/harness.md.\n');
  const backup=join(site,'artifacts/admin/launch-backups',`${hash(original)}.json`);
  if(!await exists(backup)){await mkdir(dirname(backup),{recursive:true});await writeFile(backup,original,{flag:'wx'});}
  const configured={...launch,admin:connection};await save(launchFile,configured);
  await save(stateFile,{stage:'configured',directory,planDigest:hash(JSON.stringify(plan)),configuredLaunchDigest:hash(await readFile(launchFile,'utf8'))});
  console.log(`Admin scaffolded at ${directory}; public website connection and hashed grant prepared. Existing forms and backend origin preserved. No cloud writes or email.`);
}
