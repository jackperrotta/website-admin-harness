import type {AdminManifest} from '../../contracts/src/index.ts';
export interface HarnessEnv {HARNESS_API_TOKEN?:string;HARNESS_SERVICE?:Fetcher}
export class HarnessError extends Error {constructor(public status:number,message:string){super(message);}}
export async function harnessRequest(manifest:AdminManifest,env:HarnessEnv,resource:'status'|'leads'|'analytics'|'leads/status',options:{days?:number;body?:unknown;mode?:'test'|'production'}={}) {
  if(!manifest.backend)throw new HarnessError(503,'Website backend is not connected');
  if(!env.HARNESS_API_TOKEN || !/^[a-zA-Z0-9_-]{32,200}$/.test(env.HARNESS_API_TOKEN))throw new HarnessError(503,'The website connection credential is missing. Ask your administrator to finish setup.');
  const path=`/api/admin/v1/${encodeURIComponent(manifest.backend.tenantId)}/${resource}`;
  const url=new URL(path,manifest.backend.origin);if(options.days)url.searchParams.set('days',String(options.days));
  if(resource==='leads'&&options.mode==='test')url.searchParams.set('mode','test');
  const request=new Request(url,{method:options.body===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:`Bearer ${env.HARNESS_API_TOKEN}`,'x-vitris-installation':manifest.installationId,'x-vitris-site-origin':manifest.site.origin,...(options.body===undefined?{}:{'content-type':'application/json'})},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
  let response:Response;
  try{response=await (env.HARNESS_SERVICE?env.HARNESS_SERVICE.fetch(request):fetch(request));}catch{throw new HarnessError(502,'The website backend is unavailable. No local demo data has been substituted.');}
  if(!response.ok){
    if(response.status===401||response.status===403)throw new HarnessError(503,'The website connection credential or its permissions were rejected. Ask your administrator to verify the connection.');
    if(response.status===404&&resource==='leads/status')throw new HarnessError(404,'Lead not found');
    throw new HarnessError(502,'The website backend could not complete this request.');
  }
  const size=Number(response.headers.get('content-length')||0);if(size>4_000_000)throw new HarnessError(502,'Website response exceeds the supported size');
  // Bound streaming responses too; no unchecked response body is persisted.
  const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let total=0;
  if(!reader)throw new HarnessError(502,'Website returned an empty response');
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>4_000_000){await reader.cancel();throw new HarnessError(502,'Website response exceeds the supported size');}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data:any;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HarnessError(502,'Website returned an invalid response');}
  if(resource==='leads/status'){if(data?.ok!==true)throw new HarnessError(502,'Website did not confirm the status change');return data;}
  if(data?.schemaVersion!==1)throw new HarnessError(502,'Website backend contract version is unsupported');
  if(data.installationId!==manifest.installationId||data.tenantId!==manifest.backend.tenantId||data.siteOrigin!==manifest.site.origin)throw new HarnessError(502,'Website backend identity does not match this installation');
  if(resource==='status'){
    if(data.installationId!==manifest.installationId||data.tenantId!==manifest.backend.tenantId||data.siteOrigin!==manifest.site.origin||!Array.isArray(data.scopes))throw new HarnessError(502,'Website backend identity does not match this installation');
  }else{
    if(!Array.isArray(data.rows)||data.rows.length>200||data.source!=='connected')throw new HarnessError(502,'Website backend response is invalid');
    if(resource==='analytics' && data.rows.some((r:any)=>typeof r.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||['views','visitors','enquiries'].some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0)))throw new HarnessError(502,'Website analytics response is invalid');
    if(resource==='leads' && data.rows.some((r:any)=>typeof r.id!=='string'||typeof r.name!=='string'||typeof r.email!=='string'||typeof r.message!=='string'||typeof r.created_at!=='string'||typeof r.status!=='string'))throw new HarnessError(502,'Website lead response is invalid');
  }
  return data;
}
