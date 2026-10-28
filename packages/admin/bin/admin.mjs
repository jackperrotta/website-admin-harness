#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile,cp,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
const exists=async path=>access(path).then(()=>true,()=>false);
function slug(value){if(!/^[a-z][a-z0-9-]{0,50}$/.test(value))throw new Error('Use a slug with lowercase letters, digits and hyphens (maximum 51 characters)');return value;}
function email(value){if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('A valid email is required');return value.toLowerCase();}
export async function run(args=process.argv.slice(2)) {
  const {positionals,values:v}=parseArgs({args,allowPositionals:true,options:{dir:{type:'string'},name:{type:'string'},slug:{type:'string'},domain:{type:'string'},website:{type:'string'},email:{type:'string'},site:{type:'string'},plan:{type:'boolean'},apply:{type:'boolean'},from:{type:'string'},'backend-origin':{type:'string'},tenant:{type:'string'}}});
  const command=positionals[0];const root=resolve(v.dir||'.');
  if(command==='init'){
    if(!v.dir)throw new Error('init requires --dir for a new installation directory');
    if(await exists(root))throw new Error('Destination exists; choose a new directory to preserve existing work');
    const id=slug(v.slug||'my-business');const name=(v.name||'My Business').trim();if(!name||name.length>100)throw new Error('Business name must contain 1–100 characters');
    const domain=v.domain||`admin.${id}.example`;
    if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))throw new Error('Provide a bare admin hostname, without a URL or path');
    const website=v.website||`https://${id}.example`;const url=new URL(website);if(url.origin!==website||url.protocol!=='https:')throw new Error('Website must be an exact HTTPS origin');
    const config={schemaVersion:1,installationId:id,business:{name,initials:name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()},site:{id,name:'Main website',origin:website},adminOrigin:`https://${domain}`,modules:['work-queue']};
    if(v['backend-origin']||v.tenant){
      if(!v['backend-origin']||!v.tenant||!/^[a-zA-Z0-9_-]{1,100}$/.test(v.tenant))throw new Error('Both a backend origin and a valid tenant ID are required');
      const backend=new URL(v['backend-origin']);if(backend.origin!==v['backend-origin']||backend.protocol!=='https:')throw new Error('Use an exact HTTPS backend origin for a production installation');
      config.backend={provider:'vitris-harness',origin:backend.origin,tenantId:v.tenant};
    }
    const version=(await read(join(packageRoot,'package.json'))).version;
    await mkdir(root,{recursive:true});
    await save(join(root,'package.json'),{name:`${id}-admin`,private:true,type:'module',scripts:{dev:'wrangler dev --config wrangler.local.jsonc --port 4391',build:'wrangler deploy --dry-run --outdir dist',plan:'vitris-admin plan',doctor:'vitris-admin doctor','db:local':'wrangler d1 migrations apply admin-local --local --config wrangler.local.jsonc',deploy:'wrangler deploy'},dependencies:{'@vitris/admin':version},devDependencies:{wrangler:'^4.135.0'}});
    await save(join(root,'admin.config.json'),config);
    const {backend:productionBackend,...localConfig}=config;
    await save(join(root,'admin.local.json'),{...localConfig,installationId:`${id}-local`,adminOrigin:'http://127.0.0.1:4391'});
    const settings={name:`${id}-admin`,main:'worker.js',compatibility_date:'2026-09-01',workers_dev:false,assets:{directory:'./public',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:true},d1_databases:[{binding:'DB',database_name:`${id}-admin`,database_id:'REPLACE_WITH_D1_ID',migrations_dir:'./migrations'}],r2_buckets:[{binding:'ASSET_STORE',bucket_name:`${id}-admin-assets`}],vars:{MODE:'production'},routes:[{pattern:domain,custom_domain:true}]};
    if(v.from){settings.vars.AUTH_FROM=email(v.from);settings.send_email=[{name:'AUTH_EMAIL',allowed_sender_addresses:[settings.vars.AUTH_FROM]}];}
    await save(join(root,'wrangler.jsonc'),settings);
    await save(join(root,'wrangler.local.jsonc'),{...settings,name:`${id}-admin-local`,main:'worker.local.js',workers_dev:false,routes:[],vars:{MODE:'local'},send_email:[],d1_databases:[{binding:'DB',database_name:'admin-local',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:'./migrations'}],r2_buckets:[{binding:'ASSET_STORE',bucket_name:`${id}-admin-local-assets`}]});
    await writeFile(join(root,'worker.js'),"import {createAdmin} from '@vitris/admin/worker';\nimport config from './admin.config.json';\nexport default createAdmin(config);\n");
    await writeFile(join(root,'worker.local.js'),"import {createAdmin} from '@vitris/admin/worker';\nimport config from './admin.local.json';\nexport default createAdmin(config);\n");
    await cp(join(packageRoot,'dist/client'),join(root,'public'),{recursive:true});
    await cp(join(packageRoot,'migrations'),join(root,'migrations'),{recursive:true});
    await cp(join(packageRoot,'agent'),join(root,'agent'),{recursive:true});
    await writeFile(join(root,'AGENTS.md'),"# Business admin installation\n\nRead agent/WORKFLOW.md before changing modules, permissions, schema or website connections.\n\nUse Cloudflare Workers, D1, R2 and Email Service by default. Never add Pages or Media editor sections. Preserve business-owned accounts and exact domain bindings.\n");
    await writeFile(join(root,'.gitignore'),'node_modules/\ndist/\n.wrangler/\n.dev.vars*\n.env*\n.vitris/\n');
    await writeFile(join(root,'README.md'),`# ${name} admin\n\nInstall dependencies, then run npm run db:local and npm run dev for synthetic local data.\n\nRun npm run plan for the Cloudflare setup checklist. Production deployment needs real D1 and R2 bindings, an active admin hostname in the deployment account, Cloudflare Email Service sender onboarding and the AUTH_EMAIL binding. Configure AUTH_FROM. Bootstrap the initial owner with vitris-admin owner --email owner@yourbusiness.com, then apply its private SQL file using Wrangler against the intended database.\n\nSee agent/WORKFLOW.md for safe agent extension steps. Existing website forms and analytics are not connected automatically.\n`);
    console.log(`Created ${root}. Next: install dependencies, run npm run db:local, then npm run dev. No cloud resources were changed.`);return;
  }
  if(command==='owner'){
    const address=email(v.email);await read(join(root,'admin.config.json'));
    const sql=`INSERT INTO users(id,email,role) VALUES('${randomUUID()}','${address.replaceAll("'","''")}','owner') ON CONFLICT(email) DO NOTHING;\n`;
    const output=join(root,'.vitris/bootstrap-owner.sql');await mkdir(dirname(output),{recursive:true});await writeFile(output,sql,{flag:'wx'});
    console.log(`Owner bootstrap SQL written to ${output}. Review and apply to the intended installation database. Existing accounts are never promoted by this command.`);return;
  }
  if(command==='module'){
    const id=slug(v.slug||'');const target=join(root,'modules',id);if(await exists(target))throw new Error('Module already exists');
    await read(join(root,'admin.config.json'));await mkdir(target,{recursive:true});
    await writeFile(join(target,'index.js'),`// Trusted build-time module. Add scoped permission checks before every mutation.\nexport default {\n  id: '${id}', version: 1, label: ${JSON.stringify(v.name||id)}, permission: 'activity:read',\n  description: 'A business-specific module',\n  async handle({request, env, manifest, user, require: authorize}) {\n    if (request.method !== 'GET') return Response.json({error: 'Method not allowed'}, {status: 405});\n    return Response.json({rows: [], message: 'Add a site-scoped query and an additive migration to connect records.'});\n  }\n};\n`);
    await writeFile(join(target,'README.md'),`# ${id}\n\nRead agent/refs/modules.md. Import this definition into both Worker entry points and pass modules: [definition] to createAdmin. Add the ID to both installation manifests. Review permission choice, add an additive migration if needed, and test disabled-module and cross-site access before deployment. This scaffold is not enabled automatically.\n`);
    console.log(`Created module source at ${target}. Follow its README to wire and verify it.`);return;
  }
  if(command==='connect'){
    if(!v.site)throw new Error('connect requires --site');const siteRoot=resolve(v.site);const launchPath=join(siteRoot,'launch.json');
    const manifest=await read(join(root,'admin.config.json'));const original=await readFile(launchPath,'utf8');const launch=JSON.parse(original);
    const connection={schemaVersion:1,installationId:manifest.installationId,siteId:manifest.site.id,url:manifest.adminOrigin};
    const planPath=join(siteRoot,'artifacts/admin-connection-plan.json');
    const plan={schemaVersion:1,siteRoot,launchPath,baseDigest:hash(original),connection};
    if(!v.apply){await save(planPath,plan);console.log(`Connection plan saved to ${planPath}. Review, then repeat with --apply. Existing backendOrigin and forms remain unchanged.`);return;}
    if(launch.admin&&JSON.stringify(launch.admin)===JSON.stringify(connection)){console.log('This admin connection is already recorded. No files changed.');return;}
    const prepared=await read(planPath);if(JSON.stringify(prepared)!==JSON.stringify(plan))throw new Error('Connection plan changed or source changed. Prepare and review a new plan.');
    if(launch.admin&&JSON.stringify(launch.admin)!==JSON.stringify(connection))throw new Error('A different admin connection exists; explicit migration is required');
    if(!launch.admin){const backup=join(siteRoot,'artifacts/admin-connection-backups',`${hash(original)}.json`);if(!await exists(backup)){await mkdir(dirname(backup),{recursive:true});await writeFile(backup,original,{flag:'wx'});}await save(launchPath,{...launch,admin:connection});}
    console.log('Public admin connection recorded. No backend traffic, form IDs, or production resources changed.');return;
  }
  if(command==='plan'||command==='doctor'){
    const manifest=await read(join(root,'admin.config.json'));const config=await read(join(root,'wrangler.jsonc'));
    const issues=[];
    if(!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id.includes('REPLACE'))issues.push('Create a dedicated D1 database and replace database_id');
    if(!config.r2_buckets?.length)issues.push('Configure an R2 ASSET_STORE binding');
    if(!config.send_email?.some(x=>x.name==='AUTH_EMAIL')||!config.vars?.AUTH_FROM)issues.push('Onboard a Cloudflare Email Service sender; configure AUTH_FROM and AUTH_EMAIL');
    if(config.vars?.MODE==='local')issues.push('Production configuration must not use local mode');
    if(!config.routes?.some(x=>x.custom_domain&&`https://${x.pattern}`===manifest.adminOrigin))issues.push('Attach the exact canonical admin Custom Domain');
    console.log(JSON.stringify({installation:manifest.installationId,adminOrigin:manifest.adminOrigin,provider:'cloudflare',configurationIssues:issues,manualChecks:['Verify account and hostname ownership','Create or verify the dedicated R2 bucket','Back up existing D1 before applying migrations','Apply migrations and bootstrap the initial owner','Verify sender-domain onboarding and restricted email binding','Deploy only after reviewing configuration; test login on the canonical HTTPS domain'],cloudWrites:false},null,2));
    if(command==='doctor'&&issues.length)process.exitCode=1;return;
  }
  console.log('vitris-admin init --dir NEW_DIRECTORY --slug acme --name "Acme" --domain admin.acme.com --website https://acme.com\nvitris-admin plan|doctor [--dir INSTALLATION]\nvitris-admin owner --email owner@business.com [--dir INSTALLATION]\nvitris-admin module --slug example --name "Example" [--dir INSTALLATION]\nvitris-admin connect --site WEBSITE_DIRECTORY --plan|--apply [--dir INSTALLATION]');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await run();}catch(error){console.error(error.message);process.exitCode=1;}}
