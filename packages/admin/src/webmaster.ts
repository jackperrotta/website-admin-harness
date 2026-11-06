import {validWebmasterScopes, type AdminManifest, type User, type WebmasterConnection, type WebmasterMember, type WebmasterResponse} from '../../contracts/src/index.ts';

export class WebmasterError extends Error {constructor(public status:number,message:string){super(message);}}
export const webmasterModule={id:'webmaster',version:1,label:'Managed by Webmaster',permission:'settings:write' as const,description:'A client-controlled, scoped website management relationship.'};
export async function webmasterSchema(db:D1Database) {
  return !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webmaster_members'").first();
}
const scope=(manifest:AdminManifest)=>[manifest.installationId,manifest.site.id,manifest.adminOrigin];
interface Member {permissions_json:string;active:number;status:string;organization_id:string;organization_name:string;revision:number}
function resolveUser(manifest:AdminManifest,user:User,member:Member|null,restricted:boolean):User|null {
  if(!member)return restricted?null:user;
  if(!manifest.modules.includes('webmaster')||!member.active||member.status!=='connected'||!['editor','analyst'].includes(user.role))return null;
  let permissions:unknown;try{permissions=JSON.parse(member.permissions_json);}catch{return null;}
  if(!validWebmasterScopes(permissions))return null;
  return {...user,webmaster:{organizationId:member.organization_id,organizationName:member.organization_name,permissions,revision:member.revision}};
}

/** Persistent membership restrictions survive module disablement and disconnection. */
export async function webmasterUser(db:D1Database,manifest:AdminManifest,user:User):Promise<User|null> {
  if(!await webmasterSchema(db))return user;
  const member=await db.prepare('SELECT m.permissions_json,m.active,c.status,c.organization_id,c.organization_name,c.revision FROM webmaster_members m JOIN webmaster_connections c USING(installation_id,site_id,admin_origin) WHERE m.installation_id=? AND m.site_id=? AND m.admin_origin=? AND m.user_id=?').bind(...scope(manifest),user.id).first<Member>();
  const restricted=!!member||!!await db.prepare('SELECT 1 FROM webmaster_members WHERE user_id=? LIMIT 1').bind(user.id).first();
  return resolveUser(manifest,user,member,restricted);
}

/** Resolve lead assignment candidates in one scoped join, without per-user database calls. */
export async function resolveTeam(db:D1Database,manifest:AdminManifest):Promise<User[]> {
  if(!await webmasterSchema(db))return (await db.prepare('SELECT id,email,role FROM users WHERE active=1 ORDER BY email LIMIT 200').all<User>()).results;
  const rows=(await db.prepare('SELECT u.id,u.email,u.role,m.permissions_json,m.active,c.status,c.organization_id,c.organization_name,c.revision,EXISTS(SELECT 1 FROM webmaster_members any_member WHERE any_member.user_id=u.id) AS restricted FROM users u LEFT JOIN webmaster_members m ON m.user_id=u.id AND m.installation_id=? AND m.site_id=? AND m.admin_origin=? LEFT JOIN webmaster_connections c ON c.installation_id=m.installation_id AND c.site_id=m.site_id AND c.admin_origin=m.admin_origin WHERE u.active=1 ORDER BY u.email LIMIT 200').bind(...scope(manifest)).all<User&Member&{restricted:number}>()).results;
  return rows.map(row=>resolveUser(manifest,{id:row.id,email:row.email,role:row.role},row.permissions_json===null?null:row,!!row.restricted)).filter((user):user is User=>!!user);
}

function parse(value:Record<string,unknown>) {
  if(Object.keys(value).some(k=>!['organizationId','organizationName','billingProvider','members','revision'].includes(k)))throw new WebmasterError(400,'Unknown connection field');
  const {organizationId,organizationName,billingProvider,members}=value;
  if(typeof organizationId!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(organizationId)||typeof organizationName!=='string'||!organizationName.trim()||organizationName.length>100||/[\r\n\x00-\x1f]/.test(organizationName)||typeof billingProvider!=='boolean')throw new WebmasterError(400,'Enter the webmaster organization and billing relationship');
  if(!Array.isArray(members)||members.length>50||!members.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).every(k=>['userId','permissions'].includes(k))&&typeof m.userId==='string'&&m.userId.length>0&&m.userId.length<=100&&validWebmasterScopes(m.permissions))||new Set(members.map(m=>m.userId)).size!==members.length)throw new WebmasterError(400,'Choose unique team members and valid operational permissions. Write access also requires read access.');
  return {organizationId,organizationName:organizationName.trim(),billingProvider,members:members as WebmasterMember[]};
}

export async function webmasterRoute(db:D1Database,manifest:AdminManifest,user:User,request:Request,data:Record<string,unknown>|undefined):Promise<Response> {
  if(!manifest.modules.includes('webmaster'))throw new WebmasterError(404,'Module is disabled');
  if(!await webmasterSchema(db))throw new WebmasterError(503,'Webmaster connections require the reviewed database migration');
  const path=new URL(request.url).pathname,base='/api/modules/webmaster',owner=user.role==='owner'&&!user.webmaster;
  if(request.method==='GET'&&path===base){
    const row=await db.prepare('SELECT organization_id,organization_name,billing_provider,status,revision FROM webmaster_connections WHERE installation_id=? AND site_id=? AND admin_origin=?').bind(...scope(manifest)).first<{organization_id:string;organization_name:string;billing_provider:number;status:WebmasterConnection['status'];revision:number}>();
    const members=row?(await db.prepare('SELECT user_id,permissions_json FROM webmaster_members WHERE installation_id=? AND site_id=? AND admin_origin=? AND active=1').bind(...scope(manifest)).all<{user_id:string;permissions_json:string}>()).results:[];
    const parsed:WebmasterMember[]=[];
    for(const member of members){
      let permissions:unknown;try{permissions=JSON.parse(member.permissions_json);}catch{throw new WebmasterError(503,'Stored webmaster permissions could not be verified');}
      if(!validWebmasterScopes(permissions))throw new WebmasterError(503,'Stored webmaster permissions could not be verified');
      parsed.push({userId:member.user_id,permissions});
    }
    const connection:WebmasterConnection|null=row?{organizationId:row.organization_id,organizationName:row.organization_name,billingProvider:!!row.billing_provider,status:row.status,revision:row.revision,members:parsed.filter(m=>owner||m.userId===user.id),permissions:[...new Set(parsed.flatMap(m=>m.permissions))]}:null;
    const eligibleUsers=owner?(await db.prepare("SELECT id,email FROM users WHERE active=1 AND role IN ('editor','analyst') ORDER BY email LIMIT 200").all<{id:string;email:string}>()).results:[];
    return Response.json({connection,canManage:owner,eligibleUsers} satisfies WebmasterResponse);
  }
  if(request.method!=='POST'||![base,base+'/disconnect'].includes(path))throw new WebmasterError(404,'Connection action not found');
  if(!owner)throw new WebmasterError(403,'Only the account owner can change or disconnect webmaster access');
  if(!data||!Number.isSafeInteger(data.revision)||Number(data.revision)<0)throw new WebmasterError(400,'A valid connection revision is required');
  const nonce=crypto.randomUUID(),revision=Number(data.revision),s=scope(manifest);
  const statements:D1PreparedStatement[]=[];
  const auditId=crypto.randomUUID();
  let action:string;
  if(path.endsWith('/disconnect')){
    if(Object.keys(data).some(k=>!['revision','acknowledgeSubscription'].includes(k))||data.acknowledgeSubscription!==true)throw new WebmasterError(400,'Confirm that disconnecting access does not cancel a subscription');
    statements.push(db.prepare("UPDATE webmaster_connections SET status='disconnected',revision=revision+1,mutation_id=? WHERE installation_id=? AND site_id=? AND admin_origin=? AND revision=? AND status='connected'").bind(nonce,...s,revision));
    action='Disconnected webmaster management access; subscriptions unchanged';
  }else{
    const config=parse(data);
    for(const member of config.members){if(!await db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND role IN ('editor','analyst')").bind(member.userId).first())throw new WebmasterError(400,'Choose active editor or analyst accounts. Owners and administrators cannot be webmaster members.');}
    statements.push(db.prepare("INSERT INTO webmaster_connections(installation_id,site_id,admin_origin,organization_id,organization_name,billing_provider,status,revision,mutation_id) SELECT ?,?,?,?,?,?,'connected',1,? WHERE ?=0 ON CONFLICT(installation_id,site_id,admin_origin) DO UPDATE SET organization_id=excluded.organization_id,organization_name=excluded.organization_name,billing_provider=excluded.billing_provider,status='connected',revision=webmaster_connections.revision+1,mutation_id=excluded.mutation_id WHERE webmaster_connections.revision=?").bind(...s,config.organizationId,config.organizationName,config.billingProvider?1:0,nonce,revision,revision));
    // UPDATE has a separate path because INSERT SELECT's WHERE also applies before conflict handling.
    if(revision>0)statements[0]=db.prepare("UPDATE webmaster_connections SET organization_id=?,organization_name=?,billing_provider=?,status='connected',revision=revision+1,mutation_id=? WHERE installation_id=? AND site_id=? AND admin_origin=? AND revision=?").bind(config.organizationId,config.organizationName,config.billingProvider?1:0,nonce,...s,revision);
    action='Updated webmaster connection and agreed operational permissions';
    statements.push(db.prepare('UPDATE webmaster_members SET active=0 WHERE installation_id=? AND site_id=? AND admin_origin=? AND EXISTS(SELECT 1 FROM webmaster_connections WHERE installation_id=? AND site_id=? AND admin_origin=? AND mutation_id=?)').bind(...s,...s,nonce));
    for(const member of config.members)statements.push(db.prepare("INSERT INTO webmaster_members(installation_id,site_id,admin_origin,user_id,permissions_json,active) SELECT ?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM webmaster_connections WHERE installation_id=? AND site_id=? AND admin_origin=? AND mutation_id=?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND role IN ('editor','analyst')) ON CONFLICT(installation_id,site_id,admin_origin,user_id) DO UPDATE SET permissions_json=excluded.permissions_json,active=1").bind(...s,member.userId,JSON.stringify(member.permissions),...s,nonce,member.userId));
  }
  // A reconnect must require a fresh sign-in rather than revive a disconnected session/link.
  if(await db.prepare("SELECT 1 FROM sqlite_master WHERE name='webmaster_reporting_grants' AND type='table'").first()){
    for(const table of ['webmaster_reporting_grants','webmaster_pairing_requests'])statements.push(db.prepare(`UPDATE ${table} SET revoked_at=? ${table==='webmaster_pairing_requests'?',code_cipher=NULL,credential_cipher=NULL':''} WHERE installation_id=? AND site_id=? AND admin_origin=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM webmaster_connections c WHERE c.installation_id=? AND c.site_id=? AND c.admin_origin=? AND c.mutation_id=? AND (c.status='disconnected' OR c.organization_id<>${table}.organization_id))`).bind(Math.floor(Date.now()/1000),...s,...s,nonce));
  }
  for(const table of ['sessions','login_tokens'])statements.push(db.prepare(`DELETE FROM ${table} WHERE user_id IN (SELECT m.user_id FROM webmaster_members m JOIN webmaster_connections c USING(installation_id,site_id,admin_origin) WHERE m.installation_id=? AND m.site_id=? AND m.admin_origin=? AND c.mutation_id=? AND (m.active=0 OR c.status='disconnected'))`).bind(...s,nonce));
  statements.push(db.prepare('INSERT INTO audit(id,actor,action) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM webmaster_connections WHERE installation_id=? AND site_id=? AND admin_origin=? AND mutation_id=?)').bind(auditId,user.email,action,...s,nonce));
  statements.push(db.prepare('INSERT INTO webmaster_activity(audit_id,installation_id,site_id,admin_origin,person_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit WHERE id=?)').bind(auditId,...s,user.id,auditId));
  const result=await db.batch(statements);
  if(!result[0].meta.changes)throw new WebmasterError(409,'The connection changed. Reload before saving.');
  return Response.json({ok:true,revision:revision+1});
}
