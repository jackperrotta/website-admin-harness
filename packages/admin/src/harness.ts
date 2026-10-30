import {isObject, isLeadRow, isAnalyticsRow, isWebsiteTheme, type WebsiteTheme, type AdminManifest, type LeadsResponse, type AnalyticsResponse, type MutationResponse} from '../../contracts/src/index.ts';
interface BackendIdentity {schemaVersion: 1; installationId: string; tenantId: string; siteOrigin: string}
interface StatusResponse extends BackendIdentity {scopes: string[]; theme?: WebsiteTheme | null}
interface HarnessResponses {status: StatusResponse; leads: LeadsResponse & BackendIdentity; analytics: AnalyticsResponse & BackendIdentity; 'leads/status': MutationResponse}
type HarnessOptions = {days?: number; body?: unknown; mode?: 'test' | 'production'};
export interface HarnessEnv {HARNESS_API_TOKEN?:string;HARNESS_SERVICE?:Pick<Fetcher, 'fetch'>}
export class HarnessError extends Error {constructor(public status:number,message:string){super(message);}}
export function harnessRequest<R extends keyof HarnessResponses>(manifest: AdminManifest, env: HarnessEnv, resource: R, options?: HarnessOptions): Promise<HarnessResponses[R]>;
export async function harnessRequest(manifest: AdminManifest, env: HarnessEnv, resource: keyof HarnessResponses, options: HarnessOptions = {}): Promise<HarnessResponses[keyof HarnessResponses]> {
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
  let data: unknown;
  try {data = JSON.parse(new TextDecoder().decode(bytes));} catch {throw new HarnessError(502, 'Website returned an invalid response');}
  if (!isObject(data)) throw new HarnessError(502, 'Website returned an invalid response');
  if (resource === 'leads/status') {
    if (data.ok !== true) throw new HarnessError(502, 'Website did not confirm the status change');
    return {...data, ok: true};
  }
  if (data.schemaVersion !== 1) throw new HarnessError(502, 'Website backend contract version is unsupported');
  if (data.installationId !== manifest.installationId || data.tenantId !== manifest.backend.tenantId || data.siteOrigin !== manifest.site.origin) throw new HarnessError(502, 'Website backend identity does not match this installation');
  const identity: BackendIdentity = {schemaVersion: 1, installationId: data.installationId, tenantId: data.tenantId, siteOrigin: data.siteOrigin};
  if (resource === 'status') {
    if (!Array.isArray(data.scopes) || !data.scopes.every((scope: unknown): scope is string => typeof scope === 'string')) throw new HarnessError(502, 'Website backend identity does not match this installation');
    if(data.theme!==undefined&&data.theme!==null&&!isWebsiteTheme(data.theme))throw new HarnessError(502,'Website theme response is invalid');
    return {...data, ...identity, scopes: data.scopes, theme:data.theme as WebsiteTheme|null|undefined};
  }
  if (!Array.isArray(data.rows) || data.rows.length > 200 || data.source !== 'connected') throw new HarnessError(502, 'Website backend response is invalid');
  if (resource === 'analytics') {
    // The original v1 backend returns UTC daily rows without window metadata.
    const timezone=data.timezone===undefined?'UTC':data.timezone;
    const days=data.days===undefined?(options.days??14):data.days;
    if (!data.rows.every(isAnalyticsRow) || typeof timezone !== 'string' || typeof days !== 'number' || !Number.isInteger(days) || days < 1) throw new HarnessError(502, 'Website analytics response is invalid');
    if(data.previousRows!==undefined&&(!Array.isArray(data.previousRows)||data.previousRows.length>200||!data.previousRows.every(isAnalyticsRow)))throw new HarnessError(502,'Website comparison analytics response is invalid');
    return {...data, ...identity, source: 'connected', rows: data.rows, previousRows:data.previousRows as AnalyticsResponse['previousRows'], timezone, days};
  }
  if (!data.rows.every(isLeadRow) || (data.writable !== undefined && typeof data.writable !== 'boolean') || (data.message !== undefined && typeof data.message !== 'string') || (data.mode !== undefined && typeof data.mode !== 'string')) throw new HarnessError(502, 'Website lead response is invalid');
  return {...data, ...identity, source: 'connected', rows: data.rows, writable: data.writable, message: data.message, mode: data.mode};
}
