import {createPassword,passwordReady,verifyPassword,validNewPassword} from './password.ts';
import {can,type AdminManifest,type User,type AccountCapabilities,type AccountAction,type AccessResponse} from '../../contracts/src/index.ts';

export interface AuthEmailMessage {to:string;from:string;subject:string;text:string}
export interface AccountEnv {DB:D1Database;MODE?:string;PASSWORD_LOGIN?:string;PASSWORD_PEPPER?:string;AUTH_ACCOUNTS_ENABLED?:string;AUTH_EMAIL_READY?:string;AUTH_EMAIL_ENCRYPTION_KEY?:string;AUTH_FROM?:string;AUTH_EMAIL?:{send(message:AuthEmailMessage):Promise<unknown>}}
export class AccountError extends Error {constructor(public status:number,message:string){super(message);}}
type Purpose=AccountAction['purpose'];
type Action={digest:string;installation_id:string;admin_origin:string;purpose:Purpose;user_id:string;email:string;role:User['role'];issued_by:string|null;expected_revision:number;expires_at:number;consumed_at:number|null;revoked_at:number|null};
const now=()=>Math.floor(Date.now()/1000);
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const bytes=(hex:string)=>Uint8Array.from(hex.match(/../g)||[],x=>parseInt(x,16));
const hex=(value:ArrayBuffer|Uint8Array)=>Array.from(value instanceof Uint8Array?value:new Uint8Array(value),n=>n.toString(16).padStart(2,'0')).join('');
const hash=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const email=(value:unknown)=>typeof value==='string'&&value.length<=254&&/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
const neutral={ok:true,message:'If this email is eligible, an email will arrive shortly. Use the most recent link.'};
const json=(value:unknown,status=200)=>Response.json(value,{status});
async function body(request:Request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AccountError(415,'JSON is required');const reader=request.body?.getReader();let total=0;const chunks:Uint8Array[]=[];if(!reader)throw new AccountError(400,'Request body is required');for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8192){await reader.cancel();throw new AccountError(413,'Request too large');}chunks.push(value);}const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}try{const data:unknown=JSON.parse(new TextDecoder().decode(all));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data as Record<string,unknown>;}catch{throw new AccountError(400,'Invalid request');}}

export class AccountService {
 constructor(private env:AccountEnv,private manifest:AdminManifest){}
 get enabled(){return this.env.AUTH_ACCOUNTS_ENABLED==='1';}
 get mailReady(){return this.enabled&&this.env.AUTH_EMAIL_READY==='1'&&!!this.env.AUTH_EMAIL&&email(this.env.AUTH_FROM)&&/^[a-f0-9]{64}$/i.test(this.env.AUTH_EMAIL_ENCRYPTION_KEY||'');}
 get ready(){return this.mailReady&&passwordReady(this.env);}
 private get scope(){return [this.manifest.installationId,this.manifest.adminOrigin];}
 private requireReady(){if(!this.ready)throw new AccountError(503,'Account email is not ready. Ask your website administrator to complete email setup.');}
 private async revision(userId:string){await this.env.DB.prepare('INSERT OR IGNORE INTO auth_profiles(installation_id,admin_origin,user_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND active=1)').bind(...this.scope,userId,userId).run();return (await this.env.DB.prepare('SELECT revision FROM auth_profiles WHERE installation_id=? AND admin_origin=? AND user_id=?').bind(...this.scope,userId).first<{revision:number}>())?.revision||0;}
 async credentialsRevision(userId:string){return this.revision(userId);}
 async capabilities(user:User|null):Promise<AccountCapabilities>{
  if(!this.enabled)return {enabled:false,emailReady:false,setupAvailable:false,emailVerified:false,canInvite:false};
  const profile=user?await this.env.DB.prepare('SELECT email_verified_at FROM auth_profiles WHERE installation_id=? AND admin_origin=? AND user_id=?').bind(...this.scope,user.id).first<{email_verified_at:number|null}>():null;
  const setup=await this.env.DB.prepare('SELECT 1 AS available FROM auth_owner_setup WHERE installation_id=? AND admin_origin=? AND claimed_at IS NULL AND NOT EXISTS(SELECT 1 FROM users)').bind(...this.scope).first();
  return {enabled:true,emailReady:this.ready,setupAvailable:!!setup,emailVerified:!!profile?.email_verified_at,canInvite:!!user&&user.role==='owner'&&!!profile?.email_verified_at&&this.ready};
 }
 private async limit(request:Request,purpose:string,target:string){
  for(const [kind,id,max]of [['email',target,5],['source',request.headers.get('cf-connecting-ip')||'local',20]] as const){const key=await hash(`${this.scope.join('|')}|accounts|${purpose}|${kind}|${id}|${Math.floor(now()/600)}`);const row=await this.env.DB.prepare('INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now()+1200).first<{attempts:number}>();if(!row||row.attempts>max)throw new AccountError(429,'Too many requests. Try again later.');}
 }
 private async cipher(id:string,value:AuthEmailMessage){const key=await crypto.subtle.importKey('raw',bytes(this.env.AUTH_EMAIL_ENCRYPTION_KEY!),{name:'AES-GCM'},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(this.scope.join('|')+'|auth-mail|'+id)},key,new TextEncoder().encode(JSON.stringify(value)));return hex(iv)+'.'+hex(encrypted);}
 private async decipher(id:string,cipher:string):Promise<AuthEmailMessage>{const [iv,data]=cipher.split('.');if(!iv||!data)throw Error('Invalid queued message');const key=await crypto.subtle.importKey('raw',bytes(this.env.AUTH_EMAIL_ENCRYPTION_KEY!),{name:'AES-GCM'},false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(this.scope.join('|')+'|auth-mail|'+id)},key,bytes(data)))) as AuthEmailMessage;}
 private async issue(purpose:Purpose,to:string,userId:string,role:User['role'],revision:number,issuedBy:string|null,eligible:boolean){
  const raw=random(),digest=await hash(raw),id=crypto.randomUUID(),seconds=purpose==='owner'||purpose==='invite'?86400:1800;
  const title={owner:'Set up your owner account',invite:'You are invited',verify:'Verify your email address',reset:'Reset your password'}[purpose];
  const path=purpose==='reset'?'/account/reset':purpose==='verify'?'/account/verify':'/account/activate';
  const name=this.manifest.business.name.replace(/[\r\n]+/g,' ').slice(0,100);
  const message:AuthEmailMessage={to,from:this.env.AUTH_FROM!,subject:`${title} · ${name} · Vitris`,text:`${title} for ${name}.\n\nOpen your business admin to continue:\n${this.manifest.adminOrigin}${path}#token=${raw}\n\nThis link works once and expires in ${seconds===86400?'24 hours':'30 minutes'}. Use only the most recent email. Your password is never included in an email.\n\nIf you did not expect this message, ignore it.\nVitris · ${name}`};
  const cipher=await this.cipher(id,message);
  await this.env.DB.batch([
   this.env.DB.prepare('INSERT INTO auth_actions(digest,installation_id,admin_origin,purpose,user_id,email,role,issued_by,expected_revision,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ?').bind(digest,...this.scope,purpose,userId,to,role,issuedBy,revision,now()+seconds,now(),eligible?1:0),
   this.env.DB.prepare('UPDATE auth_actions SET revoked_at=? WHERE installation_id=? AND admin_origin=? AND purpose=? AND email=? AND digest<>? AND consumed_at IS NULL AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM auth_actions WHERE digest=?)').bind(now(),...this.scope,purpose,to,digest,digest),
   this.env.DB.prepare("UPDATE auth_mail_outbox SET status='superseded' WHERE installation_id=? AND admin_origin=? AND status IN ('pending','sending','failed') AND action_digest IN (SELECT digest FROM auth_actions WHERE revoked_at IS NOT NULL)").bind(...this.scope),
   this.env.DB.prepare("INSERT INTO auth_mail_outbox(id,installation_id,admin_origin,action_digest,message_cipher,status,created_at) SELECT ?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM auth_actions WHERE digest=?)").bind(id,...this.scope,digest,cipher,now(),digest),
  ]);
 }
 private async load(raw:unknown):Promise<Action>{
  if(typeof raw!=='string'||!(/^[a-f0-9]{64}$/).test(raw))throw new AccountError(400,'This link is invalid or expired. Request a new email.');
  const row=await this.env.DB.prepare('SELECT * FROM auth_actions WHERE digest=? AND installation_id=? AND admin_origin=? AND expires_at>? AND consumed_at IS NULL AND revoked_at IS NULL').bind(await hash(raw),...this.scope,now()).first<Action>();
  if(!row)throw new AccountError(400,'This link is invalid or expired. Request a new email.');return row;
 }
 async publicRoute(request:Request,path:string):Promise<Response|null>{
  if(!this.enabled||!['/api/auth/setup/request','/api/auth/password/reset/request','/api/auth/action','/api/auth/action/complete'].includes(path))return null;
  if(request.method!=='POST')throw new AccountError(405,'Method not allowed');this.requireReady();const data=await body(request);
  if(path.endsWith('/request')){
   if(!email(data.email))throw new AccountError(400,'Enter a valid email address');const address=(data.email as string).trim().toLowerCase();
   const purpose=path.includes('/setup/')?'owner':'reset';await this.limit(request,purpose,address);
   const user=await this.env.DB.prepare('SELECT id,email,role FROM users WHERE email=? AND active=1').bind(address).first<User>();
   const setup=purpose==='owner'?await this.env.DB.prepare('SELECT email FROM auth_owner_setup WHERE installation_id=? AND admin_origin=? AND email=? AND claimed_at IS NULL AND NOT EXISTS(SELECT 1 FROM users)').bind(...this.scope,address).first():null;
   await this.issue(purpose,address,user?.id||crypto.randomUUID(),purpose==='owner'?'owner':user?.role||'editor',user?await this.revision(user.id):0,null,purpose==='owner'?!!setup:!!user);
   return json(neutral);
  }
  await this.limit(request,path.endsWith('/complete')?'complete':'inspect',await hash(String(data.token).slice(0,128)));const action=await this.load(data.token);
  if(path==='/api/auth/action')return json({purpose:action.purpose,email:action.email,expiresAt:action.expires_at,business:this.manifest.business.name} satisfies AccountAction);
  let credential:{salt:string;tag:string;iterations:number;key_bits:number}|null=null;
  if(action.purpose!=='verify'){
   if(!validNewPassword(data.password)||data.password!==data.confirmPassword)throw new AccountError(400,'Use at least 15 characters and enter the same password twice (maximum 256).');
   credential=await createPassword(this.env,data.password);
  }
  const statements=[this.env.DB.prepare('INSERT INTO auth_action_completions(digest,installation_id,admin_origin,created_at,salt,tag,iterations,key_bits) VALUES(?,?,?,?,?,?,?,?)').bind(action.digest,...this.scope,now(),credential?.salt||null,credential?.tag||null,credential?.iterations||null,credential?.key_bits||null)];
  if(action.purpose==='reset'){
   const id=crypto.randomUUID();const message:AuthEmailMessage={to:action.email,from:this.env.AUTH_FROM!,subject:`Password changed · ${this.manifest.business.name.replace(/[\r\n]+/g,' ')} · Vitris`,text:`Your ${this.manifest.business.name} admin password was changed. Existing sessions have been signed out.\n\nSign in at ${this.manifest.adminOrigin}\n\nIf you did not make this change, contact your website administrator immediately. No password is included in this message.\nVitris`};
   statements.push(this.env.DB.prepare("INSERT INTO auth_mail_outbox(id,installation_id,admin_origin,message_cipher,status,created_at) VALUES(?,?,?,?,'pending',?)").bind(id,...this.scope,await this.cipher(id,message),now()));
  }
  try{await this.env.DB.batch(statements);}catch(error){if(/auth_|UNIQUE constraint/.test(String(error)))throw new AccountError(400,'This link is no longer valid. Request a new email.');throw error;}
  return json({ok:true,purpose:action.purpose,message:action.purpose==='verify'?'Email verified.':action.purpose==='reset'?'Password changed. Sign in with your new password.':'Account activated. Sign in with your email and password.'});
 }
 async access(request:Request,path:string,user:User):Promise<Response|null>{
  if(!this.enabled)return null;
  if(path==='/api/auth/verification/request'&&request.method==='POST'){
   this.requireReady();await this.limit(request,'verify',user.email);const capability=await this.capabilities(user);await this.issue('verify',user.email,user.id,user.role,await this.revision(user.id),null,!capability.emailVerified);return json(neutral);
  }
  if(!path.startsWith('/api/access/invitations'))return null;
  if(request.method!=='POST')throw new AccountError(405,'Method not allowed');
  this.requireReady();const capability=await this.capabilities(user);if(!can(user.role,'access:write')||!capability.canInvite)throw new AccountError(403,'Only a verified owner can manage team invitations.');
  const data=await body(request);await this.limit(request,'invite',user.id);
  const match=path.match(/^\/api\/access\/invitations\/([a-f0-9]{64})\/(cancel|resend)$/);
  if(path!=='/api/access/invitations'&&!match)throw new AccountError(404,'Not found');
  let previous:Action|null=null;
  if(match){previous=await this.env.DB.prepare("SELECT * FROM auth_actions WHERE digest=? AND installation_id=? AND admin_origin=? AND purpose='invite'").bind(match[1],...this.scope).first<Action>();if(!previous)throw new AccountError(404,'Invitation not found');}
  if(match?.[2]==='cancel'){
   await this.env.DB.batch([
    this.env.DB.prepare("UPDATE auth_actions SET revoked_at=? WHERE digest=? AND installation_id=? AND admin_origin=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND active=1)").bind(now(),previous!.digest,...this.scope,user.id),
    this.env.DB.prepare("UPDATE auth_mail_outbox SET status='superseded' WHERE action_digest=? AND installation_id=? AND admin_origin=? AND status IN ('pending','sending','failed')").bind(previous!.digest,...this.scope),
   ]);return json({ok:true,message:'Invitation canceled.'});
  }
  const actorRevision=await this.revision(user.id);
  if(!await verifyPassword(this.env,user.id,data.currentPassword))throw new AccountError(403,'Your current password is incorrect.');
  const address=previous?.email||(typeof data.email==='string'?data.email.trim().toLowerCase():'');
  const role=previous?.role||data.role;if(!email(address)||!['administrator','editor','analyst'].includes(String(role)))throw new AccountError(400,'Enter an email and choose a team role. Ownership cannot be granted by invitation.');
  if(await this.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(address).first())throw new AccountError(409,'An account for this email already exists.');
  try{await this.issue('invite',address,crypto.randomUUID(),role as User['role'],actorRevision,user.id,true);}catch(error){if(/auth_invite_forbidden/.test(String(error)))throw new AccountError(403,'The owner or invitation is no longer eligible.');throw error;}
  return json({ok:true,message:'Invitation email queued.'});
 }
 async list(user:User):Promise<AccessResponse>{
  const capabilities=await this.capabilities(user);
  const rows=(await this.env.DB.prepare('SELECT u.id,u.email,u.role,u.active,p.email_verified_at FROM users u LEFT JOIN auth_profiles p ON p.user_id=u.id AND p.installation_id=? AND p.admin_origin=? ORDER BY u.email').bind(...this.scope).all<AccessResponse['rows'][number]>()).results;
  const invitations=user.role==='owner'?(await this.env.DB.prepare("SELECT a.digest AS id,a.email,a.role,a.expires_at AS expiresAt,CASE WHEN a.consumed_at IS NOT NULL THEN 'accepted' WHEN a.revoked_at IS NOT NULL THEN 'canceled' WHEN a.expires_at<=? THEN 'expired' ELSE 'pending' END AS status,COALESCE(o.status,'pending') AS delivery FROM auth_actions a LEFT JOIN auth_mail_outbox o ON o.action_digest=a.digest WHERE a.installation_id=? AND a.admin_origin=? AND a.purpose='invite' ORDER BY a.created_at DESC,a.digest LIMIT 100").bind(now(),...this.scope).all<NonNullable<AccessResponse['invitations']>[number]>()).results:[];
  return {rows,invitations,accountAuth:capabilities};
 }
 async tick(){
  if(!this.mailReady)return;
  await this.env.DB.prepare("UPDATE auth_mail_outbox SET status='failed',lease_id=NULL WHERE installation_id=? AND admin_origin=? AND status='sending' AND lease_until<=?").bind(...this.scope,now()).run();
  const rows=(await this.env.DB.prepare("SELECT id FROM auth_mail_outbox WHERE installation_id=? AND admin_origin=? AND status='pending' ORDER BY created_at LIMIT 5").bind(...this.scope).all<{id:string}>()).results;
  for(const {id}of rows){
   const lease=random();const row=await this.env.DB.prepare("UPDATE auth_mail_outbox SET status='sending',lease_id=?,lease_until=?,attempts=attempts+1 WHERE id=? AND installation_id=? AND admin_origin=? AND status='pending' RETURNING message_cipher,action_digest").bind(lease,now()+120,id,...this.scope).first<{message_cipher:string;action_digest:string|null}>();if(!row)continue;
   try{
    if(row.action_digest&&!await this.env.DB.prepare('SELECT 1 FROM auth_actions WHERE digest=? AND installation_id=? AND admin_origin=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?').bind(row.action_digest,...this.scope,now()).first()){
     await this.env.DB.prepare("UPDATE auth_mail_outbox SET status='superseded',lease_id=NULL WHERE id=? AND lease_id=?").bind(id,lease).run();continue;
    }
    const message=await this.decipher(id,row.message_cipher);if(!email(message.to)||message.from!==this.env.AUTH_FROM)throw Error('Invalid message destination');
    await this.env.AUTH_EMAIL!.send(message);
    await this.env.DB.prepare("UPDATE auth_mail_outbox SET status='sent',sent_at=?,lease_id=NULL WHERE id=? AND lease_id=? AND status='sending'").bind(now(),id,lease).run();
   }catch{await this.env.DB.prepare("UPDATE auth_mail_outbox SET status='failed',lease_id=NULL WHERE id=? AND lease_id=? AND status='sending'").bind(id,lease).run();}
  }
 }
}
