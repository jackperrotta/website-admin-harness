import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve,dirname,join} from 'node:path';
import {StripeClient,BillingError,configuration,stripeApiVersion} from '../packages/admin/src/billing/stripe.ts';
import type {StripeBillingEnv} from '../packages/admin/src/billing/stripe.ts';
import type {StripeBillingConfig} from '../packages/contracts/src/stripe-billing.ts';
const {values}=parseArgs({options:{env:{type:'string'},config:{type:'string'},report:{type:'string'}}});
try {
  if(!values.env||!values.config){console.log(JSON.stringify({ok:false,code:'installation_paths_required',error:'Specify --env and --config from the intended installation. No shared harness credentials are used.',financialWrites:false}));process.exitCode=1;}
  else {
  const configPath=resolve(values.config),envPath=resolve(values.env);
  const config=configuration(JSON.parse(await readFile(configPath,'utf8')) as StripeBillingConfig),raw=await readFile(envPath,'utf8');
  const secrets:Record<string,string>={};for(const line of raw.split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const match=line.match(/^([A-Z_]+)\s*=\s*(.*)$/);if(!match)throw Error('Invalid private environment file');const value=match[2].trim();secrets[match[1]]=value.startsWith('"')?JSON.parse(value):value.startsWith("'")&&value.endsWith("'")?value.slice(1,-1):value;}
  const manifest={schemaVersion:1 as const,installationId:'stripe-local-verification',business:{name:'Private account verification',initials:'PV'},site:{id:'stripe-local-verification',name:'Private verification',origin:'https://verification.example.test'},adminOrigin:'http://127.0.0.1:4396',modules:['billing']};
  const client=new StripeClient({...secrets,MODE:'local'} as unknown as StripeBillingEnv,manifest,config),account=await client.verify();
  const result={ok:true,accountId:account.id,mode:config.mode,apiVersion:stripeApiVersion,verifiedAt:new Date().toISOString(),financialWrites:false,webhookDeliveryVerified:false};
  const report=resolve(values.report||join(dirname(configPath),`${config.mode}-verification.json`));await mkdir(dirname(report),{recursive:true});await writeFile(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }
}catch(error){console.log(JSON.stringify({ok:false,code:error instanceof BillingError?error.code:'private_setup_required',error:error instanceof BillingError?error.message:'Complete the private configuration and matching-mode secret file before verification.',financialWrites:false}));process.exitCode=1;}
