import {matchingProperty,parseSearchQuery,searchWindow} from './query.ts';
import {userCan,isLoopback,type AdminManifest,type User} from '../../../contracts/src/index.ts';
import {searchTypes,searchLimitations,type SearchReport,type SearchRow,type SearchConsoleStatus,type SearchConsoleAppSettings} from '../../../contracts/src/search-console.ts';
import {encrypt,decrypt,encryptionReady,digest,random,base64url} from '../scheduling/calendars/crypto.ts';
import {webmasterUser} from '../webmaster.ts';
import {SearchConsoleError,type SearchConsoleEnv} from './types.ts';

type Env = SearchConsoleEnv & {DB:D1Database;MODE?:string};
interface Connection {revision:number;tokens_cipher:string|null;property:string|null;writable:number;last_synced_at:string|null;error:string|null;next_type:number}
interface AppSettings {revision:number;clientId:string;clientSecret:string;source:SearchConsoleAppSettings['source']}
const now=()=>Math.floor(Date.now()/1000);
const json=(value:unknown,status=200,headers:HeadersInit={})=>Response.json(value,{status,headers});
function fail(status:number,code:string,message:string):never{throw new SearchConsoleError(status,code,message);}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export class SearchConsoleService {
  readonly scope:string;
  readonly env:Env;readonly manifest:AdminManifest;
  constructor(env:Env,manifest:AdminManifest){this.env=env;this.manifest=manifest;this.scope=JSON.stringify([manifest.installationId,manifest.site.id,manifest.adminOrigin]);}
  private get keys(){return {CALENDAR_TOKEN_KEYS:this.env.SEARCH_CONSOLE_TOKEN_KEYS};}
  private get context(){return 'search-console:'+this.scope;}
  private get callback(){return this.manifest.adminOrigin+'/api/search-console/oauth/callback';}
  private async application():Promise<AppSettings>{
    const stored=await this.env.DB.prepare('SELECT revision,credentials_cipher FROM search_console_apps WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id).first<{revision:number;credentials_cipher:string}>();
    if(stored){
      if(!encryptionReady(this.keys))fail(503,'encryption_required','Google connection storage is being prepared. Contact your administrator.');
      const value=await decrypt<{clientId:string;clientSecret:string}>(this.keys,this.context+':application',stored.credentials_cipher);
      return {...value,revision:stored.revision,source:'admin'};
    }
    return {revision:0,clientId:this.env.SEARCH_CONSOLE_CLIENT_ID||'',clientSecret:this.env.SEARCH_CONSOLE_CLIENT_SECRET||'',source:this.env.SEARCH_CONSOLE_CLIENT_ID&&this.env.SEARCH_CONSOLE_CLIENT_SECRET?'environment':'not-configured'};
  }
  async appSettings():Promise<SearchConsoleAppSettings>{const app=await this.application();return {revision:app.revision,clientId:app.clientId,clientSecretSet:!!app.clientSecret,encryptionReady:encryptionReady(this.keys),redirectUri:this.callback,source:app.source};}
  async saveApp(input:Record<string,unknown>){
    if(!encryptionReady(this.keys))fail(503,'encryption_required','Google connection storage is being prepared. Contact your administrator.');
    const previous=await this.application(),clientId=typeof input.clientId==='string'?input.clientId.trim():'',clientSecret=typeof input.clientSecret==='string'&&input.clientSecret?input.clientSecret:previous.clientSecret;
    if(!Number.isSafeInteger(input.revision)||Number(input.revision)<0||input.revision!==previous.revision)fail(409,'app_changed','Google application settings changed. Reload before saving.');
    if(!/^[a-zA-Z0-9_.-]{1,250}\.apps\.googleusercontent\.com$/.test(clientId)||!/^\S{8,512}$/.test(clientSecret))fail(400,'invalid_app','Enter the Google Web application client ID and client secret.');
    if(clientId!==previous.clientId&&!input.clientSecret)fail(400,'secret_required','Enter the matching client secret when changing the Google client ID.');
    const cipher=await encrypt(this.keys,this.context+':application',{clientId,clientSecret});
    const row=await this.env.DB.prepare('INSERT INTO search_console_apps(scope,site_id,revision,credentials_cipher,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(scope) DO UPDATE SET revision=revision+1,credentials_cipher=excluded.credentials_cipher,updated_at=excluded.updated_at WHERE revision=? RETURNING revision').bind(this.scope,this.manifest.site.id,cipher,now(),input.revision).first<{revision:number}>();
    if(!row)fail(409,'app_changed','Google application settings changed. Reload before saving.');
    await this.env.DB.batch([
      this.env.DB.prepare('UPDATE search_console_connections SET tokens_cipher=NULL,property=NULL,writable=0,revision=revision+1,last_synced_at=NULL,error=NULL,lease_until=0 WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id),
      this.env.DB.prepare('DELETE FROM search_console_oauth WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id),
      this.env.DB.prepare('DELETE FROM search_console_reports WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id),
    ]);
    return this.appSettings();
  }
  private async connection():Promise<Connection>{return await this.env.DB.prepare('SELECT * FROM search_console_connections WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id).first<Connection>()??{revision:0,tokens_cipher:null,property:null,writable:0,last_synced_at:null,error:null,next_type:0};}
  async status():Promise<SearchConsoleStatus>{const c=await this.connection(),app=await this.application();return {configured:!!app.clientId&&!!app.clientSecret&&encryptionReady(this.keys),connected:!!c.tokens_cipher,property:c.property,revision:c.revision,canSubmitSitemaps:!!c.writable,lastSyncedAt:c.last_synced_at,error:c.error};}
  private async remote(url:string,init:RequestInit={}):Promise<Record<string,unknown>> {
    const fixture=this.env.SEARCH_CONSOLE_HTTP;
    if(fixture&&!(this.env.MODE==='local'&&this.env.SEARCH_CONSOLE_FIXTURE_MODE==='1'&&isLoopback(this.manifest.adminOrigin)))fail(503,'fixture_forbidden','Search Console fixture transport requires an explicit local installation.');
    let response:Response;
    try{response=await (fixture?fixture.fetch(new Request(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)})):fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)}));}catch{fail(502,'google_unavailable','Google Search Console could not be reached. Try again later.');}
    const reader=response!.body?.getReader();let size=0;const parts:Uint8Array[]=[];
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();fail(502,'google_response_large','Google response exceeded the limit. Request fewer rows.');}parts.push(value);}
    if(!response!.ok){const status=response!.status;if(url==='https://oauth2.googleapis.com/token'&&status===400)fail(403,'google_authorization','Google authorization is no longer valid. Reconnect Search Console or check the OAuth application settings.');fail(status===429?429:status===401||status===403?403:502,status===429?'google_quota':status===401||status===403?'google_access':'google_error',status===429?'Google quota reached. Try again later.':status===401||status===403?'Google access was denied. Check property access or reconnect.':'Google could not return this report. Some report types may be unavailable for this property.');}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    try{const result=size?JSON.parse(new TextDecoder().decode(bytes)):{};if(!record(result))throw Error();return result;}catch{fail(502,'google_response_invalid','Google returned an invalid response.');}
  }
  private async token(c:Connection):Promise<string>{
    const app=await this.application();
    if(!app.clientId||!app.clientSecret||!encryptionReady(this.keys))fail(503,'setup_required','Complete Google connection setup in Settings.');
    if(!c.tokens_cipher)fail(409,'not_connected','Connect Google Search Console first.');
    const stored=await decrypt<{refreshToken:string}>(this.keys,this.context,c.tokens_cipher!);
    const data=await this.remote('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,grant_type:'refresh_token',refresh_token:stored.refreshToken})});
    if(typeof data.access_token!=='string')fail(502,'google_token_invalid','Google did not return an access token. Reconnect Search Console.');
    return data.access_token as string;
  }
  private async api(c:Connection,path:string,data?:unknown,method?:string,access?:string){const token=access??await this.token(c);const result=await this.remote(path,{method:method??(data===undefined?'GET':'POST'),headers:{authorization:'Bearer '+token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});if((await this.connection()).revision!==c.revision)fail(409,'connection_changed','The Search Console connection changed during this request. Reload.');return result;}
  private cookie(value:string,clear=false){return `vitris-search-oauth=${value}; Path=/api/search-console/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=${clear?0:600}${new URL(this.manifest.adminOrigin).protocol==='https:'?'; Secure':''}`;}
  async begin(user:User,writable:boolean){
    const app=await this.application();
    if(!app.clientId||!app.clientSecret||!encryptionReady(this.keys))fail(503,'setup_required','Complete Google connection setup in Settings.');
    await this.env.DB.prepare('INSERT OR IGNORE INTO search_console_connections(scope,site_id) VALUES(?,?)').bind(this.scope,this.manifest.site.id).run();
    const c=await this.connection(),state=random(),browser=random(),verifier=random();
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM search_console_oauth WHERE expires_at<? OR scope=?').bind(now(),this.scope),
      this.env.DB.prepare('INSERT INTO search_console_oauth(digest,scope,site_id,user_id,revision,browser_digest,verifier_cipher,writable,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(await digest(state),this.scope,this.manifest.site.id,user.id,c.revision,await digest(browser),await encrypt(this.keys,this.context,{verifier,appRevision:app.revision}),writable?1:0,now()+600),
    ]);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:app.clientId,redirect_uri:this.callback,response_type:'code',scope:'https://www.googleapis.com/auth/'+(writable?'webmasters':'webmasters.readonly'),access_type:'offline',prompt:'consent',state,code_challenge:base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),code_challenge_method:'S256'}).toString();
    return json({url:url.href},200,{'set-cookie':this.cookie(browser)});
  }
  async complete(request:Request){
    const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
    const browser=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('vitris-search-oauth='))?.slice(20);
    if(!state||state.length>200||!browser||browser.length>200)fail(400,'oauth_invalid','This Google connection request is invalid or expired. Start again from Settings.');
    const accepted=await this.env.DB.prepare('DELETE FROM search_console_oauth WHERE digest=? AND browser_digest=? AND scope=? AND site_id=? AND expires_at>? RETURNING *').bind(await digest(state!),await digest(browser!),this.scope,this.manifest.site.id,now()).first<{user_id:string;revision:number;verifier_cipher:string;writable:number}>();
    if(!accepted||!code||code.length>4096)fail(400,'oauth_invalid','Google authorization was cancelled, expired or already used. Start again from Settings.');
    const raw=await this.env.DB.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(accepted!.user_id).first<User>();
    const user=raw?await webmasterUser(this.env.DB,this.manifest,raw):null;
    if(!user||!userCan(user,'search-console:manage'))fail(403,'access_revoked','Connection management access has been revoked.');
    const {verifier,appRevision}=await decrypt<{verifier:string;appRevision:number}>(this.keys,this.context,accepted!.verifier_cipher),app=await this.application();
    if(appRevision!==app.revision)fail(409,'app_changed','Google application settings changed during authorization. Start again.');
    const data=await this.remote('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,grant_type:'authorization_code',redirect_uri:this.callback,code:code!,code_verifier:verifier})});
    const wanted='https://www.googleapis.com/auth/'+(accepted!.writable?'webmasters':'webmasters.readonly');
    const granted=typeof data.scope==='string'?data.scope.split(' '):[];
    if(typeof data.refresh_token!=='string'||!granted.includes(wanted)&&!(accepted!.writable===0&&granted.includes('https://www.googleapis.com/auth/webmasters')))fail(400,'oauth_scope','Google did not grant the requested offline Search Console access. Reconnect and approve the requested permission.');
    const currentRaw=await this.env.DB.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(accepted!.user_id).first<User>();
    const currentUser=currentRaw?await webmasterUser(this.env.DB,this.manifest,currentRaw):null;
    if(!currentUser||!userCan(currentUser,'search-console:manage'))fail(403,'access_revoked','Connection management access has been revoked.');
    const fence=currentUser!.webmaster?" AND EXISTS(SELECT 1 FROM webmaster_members m JOIN webmaster_connections c USING(installation_id,site_id,admin_origin) WHERE m.installation_id=? AND m.site_id=? AND m.admin_origin=? AND m.user_id=? AND m.active=1 AND c.status='connected' AND c.revision=?)":'';
    const fenceArgs=currentUser!.webmaster?[this.manifest.installationId,this.manifest.site.id,this.manifest.adminOrigin,currentUser!.id,currentUser!.webmaster.revision]:[];
    const result=await this.env.DB.prepare('UPDATE search_console_connections SET tokens_cipher=?,property=NULL,writable=?,revision=revision+1,error=NULL,last_synced_at=NULL,next_sync_at=0,lease_until=0 WHERE scope=? AND site_id=? AND revision=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND role=?) AND COALESCE((SELECT revision FROM search_console_apps WHERE scope=? AND site_id=?),0)=?'+fence).bind(await encrypt(this.keys,this.context,{refreshToken:data.refresh_token}),accepted!.writable,this.scope,this.manifest.site.id,accepted!.revision,currentUser!.id,currentUser!.role,this.scope,this.manifest.site.id,app.revision,...fenceArgs).run();
    if(!result.meta.changes)fail(409,'connection_changed','Connection settings changed during Google authorization. Start again.');
    await this.env.DB.prepare('INSERT INTO audit(id,actor,action) VALUES(?,?,?)').bind(crypto.randomUUID(),user!.email,'Connected Google Search Console').run();
    return new Response(null,{status:303,headers:{location:this.manifest.adminOrigin+'/#settings','set-cookie':this.cookie('',true)}});
  }
  async properties(){const c=await this.connection();const data=await this.api(c,'https://www.googleapis.com/webmasters/v3/sites');const entries=Array.isArray(data.siteEntry)?data.siteEntry:[];return {properties:entries.filter(p=>record(p)&&typeof p.siteUrl==='string'&&['siteOwner','siteFullUser','siteRestrictedUser'].includes(String(p.permissionLevel))&&matchingProperty(p.siteUrl,this.manifest.site.origin))};}
  async select(property:unknown,revision:unknown){
    if(typeof property!=='string'||!matchingProperty(property,this.manifest.site.origin))fail(400,'property_mismatch','Select a property matching this installation’s exact website origin or its domain.');
    const c=await this.connection();const remote=await this.api(c,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(property as string));
    if(remote.siteUrl!==property||!['siteOwner','siteFullUser','siteRestrictedUser'].includes(String(remote.permissionLevel)))fail(403,'property_unverified','This Google account does not have verified access to the selected property.');
    const result=await this.env.DB.prepare('UPDATE search_console_connections SET property=?,revision=revision+1,last_synced_at=NULL,error=NULL,next_type=0,next_sync_at=0,lease_until=0 WHERE scope=? AND site_id=? AND revision=? AND tokens_cipher IS NOT NULL').bind(property,this.scope,this.manifest.site.id,revision).run();
    if(!result.meta.changes)fail(409,'connection_changed','Settings changed. Reload before selecting a property.');
    return this.status();
  }
  async disconnect(revision:unknown){
    const result=await this.env.DB.prepare('UPDATE search_console_connections SET tokens_cipher=NULL,property=NULL,writable=0,revision=revision+1,last_synced_at=NULL,error=NULL,lease_until=0 WHERE scope=? AND site_id=? AND revision=?').bind(this.scope,this.manifest.site.id,revision).run();
    if(!result.meta.changes)fail(409,'connection_changed','Settings changed. Reload before disconnecting.');
    await this.env.DB.batch([this.env.DB.prepare('DELETE FROM search_console_oauth WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id),this.env.DB.prepare('DELETE FROM search_console_reports WHERE scope=? AND site_id=?').bind(this.scope,this.manifest.site.id)]);
    return {ok:true};
  }
  private selected(c:Connection){if(!c.tokens_cipher||!c.property||!matchingProperty(c.property,this.manifest.site.origin))fail(409,'property_required','Connect Google and select the website’s Search Console property in Settings.');}
  async report(input:unknown,refresh=false,connection?:Connection,access?:string):Promise<SearchReport>{
    const query=parseSearchQuery(input),c=connection??await this.connection();this.selected(c);
    // Domain properties may contain sibling sites. Never import their traffic into this installation.
    if(c.property!.startsWith('sc-domain:'))query.dimensionFilterGroups=[...(query.dimensionFilterGroups||[]),{groupType:'and',filters:[{dimension:'page',operator:'includingRegex',expression:'^'+this.manifest.site.origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/'}]}];
    const key=await digest(JSON.stringify(query));
    const cached=await this.env.DB.prepare('SELECT report_json,fetched_at FROM search_console_reports WHERE scope=? AND site_id=? AND revision=? AND report_key=?').bind(this.scope,this.manifest.site.id,c.revision,key).first<{report_json:string;fetched_at:number}>();
    if(!refresh&&cached&&cached.fetched_at>now()-21600)return JSON.parse(cached.report_json) as SearchReport;
    const data=await this.api(c,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(c.property!)+'/searchAnalytics/query',query,undefined,access);
    const rows=data.rows??[];
    if(!Array.isArray(rows)||rows.length>query.rowLimit||rows.some(r=>!record(r)||!['clicks','impressions','ctr'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])&&Number(r[k])>=0)||(r.position!==undefined&&(typeof r.position!=='number'||!Number.isFinite(r.position)))||(query.dimensions.length>0&&(!Array.isArray(r.keys)||r.keys.length!==query.dimensions.length||r.keys.some(k=>typeof k!=='string')))))fail(502,'google_response_invalid','Google returned invalid search performance rows.');
    const report:SearchReport={source:'google-search-console',property:c.property!,timezone:'America/Los_Angeles',request:query,rows:rows as SearchRow[],fetchedAt:new Date().toISOString(),nextStartRow:rows.length===query.rowLimit?query.startRow+rows.length:null,persisted:true,...(typeof data.responseAggregationType==='string'?{responseAggregationType:data.responseAggregationType}:{}),...(data.metadata?{metadata:data.metadata}:{}),limitations:[...searchLimitations]};
    // D1 has a per-row size limit. Oversized pages remain available but are never mislabeled as archived.
    if(new TextEncoder().encode(JSON.stringify(report)).length>700000)report.persisted=false;
    else await this.env.DB.prepare('INSERT INTO search_console_reports(scope,site_id,revision,report_key,report_json,fetched_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM search_console_connections WHERE scope=? AND site_id=? AND revision=? AND tokens_cipher IS NOT NULL) ON CONFLICT(scope,revision,report_key) DO UPDATE SET report_json=excluded.report_json,fetched_at=excluded.fetched_at').bind(this.scope,this.manifest.site.id,c.revision,key,JSON.stringify(report),now(),this.scope,this.manifest.site.id,c.revision).run();
    if((await this.connection()).revision!==c.revision)fail(409,'connection_changed','The Search Console connection changed during this request. Reload.');
    return report;
  }
  async sitemaps(){const c=await this.connection();this.selected(c);const result=await this.api(c,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(c.property!)+'/sitemaps');return {...result,sitemap:Array.isArray(result.sitemap)?result.sitemap.filter(s=>{try{return record(s)&&typeof s.path==='string'&&new URL(s.path).origin===this.manifest.site.origin;}catch{return false;}}):[],fetchedAt:new Date().toISOString()};}
  async submitSitemap(value:unknown){
    const c=await this.connection();this.selected(c);
    if(!c.writable)fail(403,'readonly_connection','Reconnect with sitemap management enabled before submitting a sitemap.');
    let url:URL;try{url=new URL(String(value));}catch{fail(400,'invalid_sitemap','Enter an absolute sitemap URL on this website.');}
    if(url!.origin!==this.manifest.site.origin||url!.username||url!.password||url!.hash||url!.search||url!.href.length>2048)fail(400,'invalid_sitemap','The sitemap must use this website’s exact origin, without credentials, query or fragment.');
    await this.api(c,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(c.property!)+'/sitemaps/'+encodeURIComponent(url!.href),undefined,'PUT');return {ok:true};
  }
  async inspect(value:unknown){
    const c=await this.connection();this.selected(c);let url:URL;try{url=new URL(String(value));}catch{fail(400,'invalid_url','Enter an absolute URL on this website.');}
    if(url!.origin!==this.manifest.site.origin||url!.username||url!.password||url!.hash||url!.href.length>2048)fail(400,'invalid_url','Inspect a URL on this website’s exact origin.');
    const result=await this.api(c,'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',{inspectionUrl:url!.href,siteUrl:c.property,languageCode:'en-US'});
    return {source:'google-search-console',property:c.property,fetchedAt:new Date().toISOString(),...result};
  }
  async tick(){
    const c=await this.connection();if(!c.tokens_cipher||!c.property)return;
    const leased=await this.env.DB.prepare('UPDATE search_console_connections SET lease_until=? WHERE scope=? AND site_id=? AND revision=? AND next_sync_at<=? AND lease_until<? RETURNING revision').bind(now()+300,this.scope,this.manifest.site.id,c.revision,now(),now()).first();if(!leased)return;
    try{
      const type=searchTypes[c.next_type%searchTypes.length],access=await this.token(c);
      // Separate reports preserve property totals. Query and page reports must never be summed together.
      for(const dimension of ['date','page','country','device',...(type==='discover'||type==='googleNews'?[]:['query','searchAppearance'])])await this.report({...searchWindow(),type,dimensions:[dimension]},true,c,access);
      await this.env.DB.prepare('UPDATE search_console_connections SET last_synced_at=?,error=NULL,next_type=?,next_sync_at=?,lease_until=0 WHERE scope=? AND site_id=? AND revision=?').bind(new Date().toISOString(),(c.next_type+1)%searchTypes.length,now()+(c.next_type===searchTypes.length-1?21600:60),this.scope,this.manifest.site.id,c.revision).run();
    }catch(error){await this.env.DB.prepare('UPDATE search_console_connections SET error=?,next_type=?,next_sync_at=?,lease_until=0 WHERE scope=? AND site_id=? AND revision=?').bind(error instanceof SearchConsoleError?error.message:'Search Console refresh failed.',(c.next_type+1)%searchTypes.length,now()+900,this.scope,this.manifest.site.id,c.revision).run();throw error;}
    await this.env.DB.batch([this.env.DB.prepare('DELETE FROM search_console_oauth WHERE expires_at<?').bind(now()),this.env.DB.prepare('DELETE FROM search_console_reports WHERE scope=? AND site_id=? AND (revision<>? OR fetched_at<?)').bind(this.scope,this.manifest.site.id,c.revision,now()-550*86400)]);
  }
}
