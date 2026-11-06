import type {AdminEnv} from '../worker.ts';
import {resolveTeam} from '../webmaster.ts';
import {samePairingIdentity,type AdminManifest,type PairingIdentity,type User} from '../../../contracts/src/index.ts';
import {hash,publicKey,random,PairingError} from './protocol.ts';
type Intent={subject_id:string;subject_email:string;key_id:string;local_user_id:string|null;approved_by:string|null};
const fail=(message:string,status=409):never=>{throw new PairingError(status,'conflict',message);};
export class PairingSignOn {
 private scope:string[];
 constructor(private env:AdminEnv,private manifest:AdminManifest){this.scope=[manifest.installationId,manifest.site.id,manifest.adminOrigin];}
 private sql(q:string,...args:any[]){return this.env.DB.prepare(q).bind(...this.scope,...args);}
 async available(){return this.manifest.webmasterSignOn?.mode==='client'&&/^[a-f0-9]{64}$/.test(this.env.WEBMASTER_SSO_KEY||'')&&!!await this.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webmaster_pairing_signon'").first()&&!!await this.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webmaster_sso_grants'").first();}
 async validate(value:any,consumer:PairingIdentity,key:JsonWebKey){
  if(!await this.available())fail('The client needs its reviewed combined connection setup before requesting sign-in.',400);
  const c=this.manifest.webmasterSignOn!;if(c.mode!=='client')return fail('Client sign-in is not configured.');
  if(!value||Object.keys(value).some(k=>!['version','subject'].includes(k))||value.version!==1||!value.subject||Object.keys(value.subject).some(k=>!['id','email'].includes(k))||typeof value.subject.email!=='string'||value.subject.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.subject.email)||value.subject.id!==c.subjectId||!samePairingIdentity(consumer,c.broker)||JSON.stringify(publicKey(key))!==JSON.stringify(publicKey(c.publicKey)))fail('The requested sign-in identity does not match the reviewed client pin.',403);
 }
 async reserve(id:string,value:any,key:JsonWebKey){return this.sql('INSERT INTO webmaster_pairing_signon(installation_id,site_id,admin_origin,request_id,subject_id,subject_email,key_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',id,value.subject.id,value.subject.email,await hash(JSON.stringify(publicKey(key))));}
 async record(id:string){if(!await this.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webmaster_pairing_signon'").first())return null;return this.sql('SELECT * FROM webmaster_pairing_signon WHERE installation_id=? AND site_id=? AND admin_origin=? AND request_id=?',id).first<Intent>();}
 async view(id:string){const row=await this.record(id);if(!row)return undefined;return {version:1 as const,subject:{id:row.subject_id,email:row.subject_email},approved:!!row.local_user_id,localUserId:row.local_user_id,users:(await resolveTeam(this.env.DB,this.manifest)).map(u=>({id:u.id,email:u.email,role:u.role,permissions:u.webmaster?.permissions}))};}
 async decision(id:string,choice:any,owner:User,alreadyApproved:boolean){const row=await this.record(id);if(!row){if(choice!==undefined)fail('This request did not ask for sign-in.',400);return null;}
  if(!choice||Object.keys(choice).some(k=>!['approved','localUserId'].includes(k))||typeof choice.approved!=='boolean'||choice.approved&&typeof choice.localUserId!=='string'||!choice.approved&&choice.localUserId!==undefined)fail('Explicitly approve sign-in and choose an existing client account, or decline sign-in.',400);
  const selected=choice.approved?choice.localUserId:null;if(alreadyApproved){if(row.local_user_id!==selected)fail('An approved request cannot change its selected account. Start a new request.');return null;}
  if(selected&&!(await resolveTeam(this.env.DB,this.manifest)).some(u=>u.id===selected))fail('The selected account or its current access is unavailable.');
  return {statement:(codeHash:string)=>this.env.DB.prepare('UPDATE webmaster_pairing_signon SET local_user_id=?,approved_by=? WHERE installation_id=? AND site_id=? AND admin_origin=? AND request_id=? AND EXISTS(SELECT 1 FROM webmaster_pairing_requests r WHERE r.installation_id=? AND r.site_id=? AND r.admin_origin=? AND r.id=? AND r.code_hash=?)').bind(selected,owner.id,...this.scope,id,...this.scope,id,codeHash)};
 }
 async exchange(id:string,consumer:PairingIdentity,key:JsonWebKey){const row=await this.record(id);if(!row)return null;await this.validate({version:1,subject:{id:row.subject_id,email:row.subject_email}},consumer,key);if(row.local_user_id&&!(await resolveTeam(this.env.DB,this.manifest)).some(u=>u.id===row.local_user_id))fail('The selected client account changed. Request fresh owner approval.');return row;}
 grant(row:Intent,id:string,grantId:string,consumer:PairingIdentity,organizationId:string){return this.sql('INSERT INTO webmaster_sso_grants(installation_id,site_id,admin_origin,id,broker_json,subject_id,subject_email,local_user_id,organization_id,key_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM webmaster_pairing_requests WHERE installation_id=? AND site_id=? AND admin_origin=? AND id=? AND grant_id=?) ON CONFLICT(installation_id,site_id,admin_origin,broker_json,subject_id) DO UPDATE SET id=excluded.id,local_user_id=excluded.local_user_id,subject_email=excluded.subject_email,organization_id=excluded.organization_id,key_id=excluded.key_id,created_at=excluded.created_at,revoked_at=NULL',random(),JSON.stringify(consumer),row.subject_id,row.subject_email,row.local_user_id,organizationId,row.key_id,Math.floor(Date.now()/1000),...this.scope,id,grantId);}
}
