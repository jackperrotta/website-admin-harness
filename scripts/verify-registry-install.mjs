import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {registryPackage} from './release-registry.mjs';

const version=JSON.parse(await readFile('packages/admin/package.json','utf8')).version;
const release=resolve('artifacts/releases',version),manifest=JSON.parse(await readFile(join(release,'manifest.json'),'utf8'));
const packages=[];
for(const pkg of manifest.packages){
  const verified=await registryPackage(pkg);assert.ok(verified,`${pkg.name} is not publicly readable yet`);
  const metadata=await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,{headers:{'cache-control':'no-cache'}})).json();
  assert.equal(metadata['dist-tags']?.alpha,version);packages.push(verified);
}
const root=await mkdtemp(join(tmpdir(),'website-admin-registry-')),admin=join(root,'fresh-admin'),cache=join(root,'empty-npm-cache');
await writeFile(join(root,'user.npmrc'),'registry=https://registry.npmjs.org/\n');await writeFile(join(root,'global.npmrc'),'');
const env={...process.env,NPM_CONFIG_CACHE:cache,NPM_CONFIG_USERCONFIG:join(root,'user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(root,'global.npmrc'),NPM_CONFIG_REGISTRY:'https://registry.npmjs.org/',WRANGLER_SEND_METRICS:'false',CI:'true'};
delete env.NPM_TOKEN;delete env.NODE_AUTH_TOKEN;delete env.VITRIS_ADMIN_API_TOKEN;
const npmCLI=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const run=(args,cwd=admin,extraEnv={})=>execFileSync(process.execPath,args,{cwd,env:{...env,...extraEnv},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000});
const npm=(args,cwd=admin)=>run([npmCLI,...args],cwd);
console.log('Creating an installation from the public registry, with a new cache and no npm credentials.');
npm(['create','--yes','@tryvitris/website-admin-harness@alpha','--','--dir',admin,'--slug','registry-fixture','--name','Registry Fixture','--domain','admin.registry-fixture.example','--website','https://registry-fixture.example'],root);
assert.equal(JSON.parse(await readFile(join(admin,'package.json'),'utf8')).dependencies['@tryvitris/website-admin-harness'],version);
npm(['install','--ignore-scripts','--no-audit','--no-fund']);
npm(['install','--ignore-scripts','--no-audit','--no-fund','--no-save',`@tryvitris/website-admin-contracts@${version}`]);
const installedCLI=join(admin,'node_modules/@tryvitris/website-admin-harness/bin/admin.mjs');
run(['--input-type=module','--eval',"import{createAdmin}from'@tryvitris/website-admin-harness/worker';import{contractVersion}from'@tryvitris/website-admin-contracts';if(typeof createAdmin!=='function'||contractVersion!==1)throw Error('Registry exports failed');"]);
const installedLock=JSON.parse(await readFile(join(admin,'package-lock.json'),'utf8'));
assert.equal(installedLock.packages['node_modules/@tryvitris/website-admin-harness'].integrity,manifest.packages.find(p=>p.name==='@tryvitris/website-admin-harness').integrity);
assert.match(await readFile(join(admin,'agent/WORKFLOW.md'),'utf8'),/Cloudflare/);
console.log('Building the freshly installed Worker and applying only local D1 migrations.');
const wrangler=join(admin,'node_modules/wrangler/bin/wrangler.js');
run([wrangler,'deploy','--dry-run','--config','wrangler.local.jsonc','--outdir','dist']);
npm(['run','db:local']);
const site=join(root,'synthetic-website'),connected=join(root,'connected-admin');await mkdir(site);
const launch={slug:'registry-connection',name:'Registry Connection',publicOrigin:'https://connection.example',backendOrigin:'https://backend.example',forms:[{id:'preserve-this-form'}]};
await writeFile(join(site,'launch.json'),JSON.stringify(launch));
const setup=['setup','--site',site,'--dir',connected,'--domain','admin.connection.example','--tenant','synthetic-tenant'];
const token='synthetic-registry-verification-token-at-least32';
run([installedCLI,...setup,'--plan']);assert.equal(JSON.parse(await readFile(join(site,'launch.json'),'utf8')).admin,undefined);
run([installedCLI,...setup,'--apply'],admin,{VITRIS_ADMIN_API_TOKEN:token});run([installedCLI,...setup,'--apply'],admin,{VITRIS_ADMIN_API_TOKEN:token});
const configured=JSON.parse(await readFile(join(site,'launch.json'),'utf8'));assert.deepEqual(configured.forms,launch.forms);assert.equal(configured.backendOrigin,launch.backendOrigin);assert.equal(configured.admin.tenantId,'synthetic-tenant');
assert.ok(!(await readFile(join(site,'launch.json'),'utf8')).includes(token));
// Use a free port and change only the synthetic installation's local manifest.
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const origin=`http://127.0.0.1:${port}`,localFile=join(admin,'admin.local.json'),local=JSON.parse(await readFile(localFile,'utf8'));local.adminOrigin=origin;await writeFile(localFile,JSON.stringify(local));
const child=spawn(process.execPath,[wrangler,'dev','--config','wrangler.local.jsonc','--port',String(port),'--show-interactive-dev-session=false'],{cwd:admin,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
let verification;
try{
  let bootstrap;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Fresh Worker exited before readiness: '+output.slice(-1500));
    try{const response=await fetch(origin+'/api/bootstrap');if(response.ok){bootstrap=await response.json();break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(bootstrap?.localDemo);assert.equal((await fetch(origin+'/api/leads')).status,401);
  const login=await fetch(origin+'/api/auth/demo',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const leads=await fetch(origin+'/api/leads',{headers:{cookie}}),analytics=await fetch(origin+'/api/analytics',{headers:{cookie}});
  assert.equal(leads.status,200);assert.equal(analytics.status,200);assert.ok(Array.isArray((await leads.json()).rows));assert.ok(Array.isArray((await analytics.json()).rows));
  assert.equal((await fetch(origin+'/')).status,200);
  verification={bootstrap:200,anonymousLeads:401,localDemoLogin:200,authenticatedLeads:200,authenticatedAnalytics:200,clientAssets:200};
}finally{
  if(child.pid&&child.exitCode===null){if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{child.kill();}}else child.kill();}
}
const report={ok:true,version,packages,environment:'fresh-anonymous-public-registry-install',temporaryDirectory:root,freshNpmCache:true,workspacePackageLinks:false,initializer:'npm create @tryvitris/website-admin-harness@alpha',workerBuild:'passed',localMigrations:'passed',harnessSetup:'plan/apply/repeat passed; website forms and backend preserved',verification,cloudWrites:false,customerDataRead:false,verifiedAt:new Date().toISOString()};
await writeFile(join(release,'registry-install-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
