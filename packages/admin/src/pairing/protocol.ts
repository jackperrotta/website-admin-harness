import {pairingBase,samePairingIdentity,type PairingIdentity,type PairingEnvelope,type PairingCredential} from '../../../contracts/src/pairing.ts';
export {pairingBase,type PairingIdentity,type PairingCredential};
export class PairingError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const encoder=new TextEncoder();
export const base64=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const unbase64=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),x=>x.charCodeAt(0));
export const hash=async(value:string)=>base64(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export const identity=(manifest:{installationId:string;site:{id:string};adminOrigin:string}):PairingIdentity=>({installationId:manifest.installationId,siteId:manifest.site.id,adminOrigin:manifest.adminOrigin});
export function origin(raw:unknown,local=false):string {
  if(typeof raw!=='string'||raw.length>250)throw new PairingError(400,'invalid_request','Use an exact public HTTPS admin origin.');
  let url:URL;try{url=new URL(raw);}catch{throw new PairingError(400,'invalid_request','Invalid admin origin.');}
  const loop=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(raw!==url.origin||url.username||url.password||(!local||!loop)&& (url.protocol!=='https:'||url.port!==''||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)||/(?:^|\.)(?:local|internal|localhost|test|invalid|example|onion)$/i.test(url.hostname))||local&&loop&&!['http:','https:'].includes(url.protocol))throw new PairingError(400,'invalid_request','Use an exact public HTTPS admin origin.');
  return raw;
}
export function publicKey(value:unknown):JsonWebKey {
  const k=value as JsonWebKey;if(!k||k.kty!=='EC'||k.crv!=='P-256'||!/^[-\w]{43}$/.test(k.x||'')||!/^[-\w]{43}$/.test(k.y||'')||k.d!==undefined)throw new PairingError(400,'invalid_request','Invalid installation signing key.');
  return {kty:'EC',crv:'P-256',x:k.x,y:k.y};
}
export async function signingKey(raw:string|undefined){let key:JsonWebKey;try{key=JSON.parse(raw||'');publicKey({kty:key.kty,crv:key.crv,x:key.x,y:key.y});if(!/^[-\w]{43}$/.test(key.d||''))throw Error();return {privateKey:await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['sign']),publicKey:publicKey({kty:key.kty,crv:key.crv,x:key.x,y:key.y})};}catch{throw new PairingError(503,'unavailable','The installation signing key is not configured.');}}
export async function sign(raw:string,key:CryptoKey){return base64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(raw)));}
export async function verify(raw:string,signature:string,key:JsonWebKey){try{if(!/^[-\w]{86}$/.test(signature))return false;return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await crypto.subtle.importKey('jwk',publicKey(key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),unbase64(signature),encoder.encode(raw));}catch{return false;}}
export async function boundedJSON(response:Response,maximum=1_000_000):Promise<Record<string,any>> {
  if(!response.ok){await response.body?.cancel();throw new PairingError([400,401,403,404,409,410,429].includes(response.status)?response.status:503,'unavailable','The reporting peer rejected or could not complete the request.');}
  const reader=response.body?.getReader();if(!reader)throw new PairingError(503,'unavailable','Empty reporting response.');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw new PairingError(413,'invalid_request','Reporting response too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new PairingError(400,'invalid_request','Invalid reporting JSON.');}
}
export async function readJSON(request:Request){if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new PairingError(415,'invalid_request','JSON is required.');return boundedJSON(new Response(request.body),16384);}
export async function seal(value:unknown,secret:string|undefined,aad:string){
  if(!/^[a-f0-9]{64}$/.test(secret||''))throw new PairingError(503,'unavailable','The pairing encryption key is not configured.');
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret!.match(/../g)!,x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  return 'v1.'+base64(iv)+'.'+base64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(JSON.stringify(value))));
}
export async function open<T>(cipher:string,secret:string|undefined,aad:string):Promise<T>{try{if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error();const [v,iv,data]=cipher.split('.');if(v!=='v1')throw Error();const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret!.match(/../g)!,x=>parseInt(x,16)),{name:'AES-GCM'},false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:encoder.encode(aad)},key,unbase64(data))));}catch{throw new PairingError(503,'unavailable','Saved pairing state could not be opened.');}}
export class PairingClient {
  constructor(public consumer:PairingIdentity,private privateJWK:string|undefined,private transport:(request:Request)=>Promise<Response>=fetch,private local=false){this.consumer={installationId:consumer.installationId,siteId:consumer.siteId,adminOrigin:origin(consumer.adminOrigin,local)};}
  async call(issuerOrigin:string,action:string,request:Record<string,unknown>,token=''){
    origin(issuerOrigin,this.local);if(!['request','poll','exchange','report','rotate','revoke'].includes(action))throw new PairingError(400,'invalid_request','Unsupported reporting action.');
    const path=pairingBase+'/'+action,key=await signingKey(this.privateJWK);
    const envelope:PairingEnvelope={version:1,identity:this.consumer,target:issuerOrigin,path,time:Math.floor(Date.now()/1000),nonce:random(),tokenHash:await hash(token),request};
    const raw=JSON.stringify(envelope);
    return boundedJSON(await this.transport(new Request(issuerOrigin+path,{method:'POST',headers:{'content-type':'application/json','x-webmaster-signature':await sign(raw,key.privateKey),...(token?{authorization:'Bearer '+token}:{})},body:raw,redirect:'manual',signal:AbortSignal.timeout(15000)})));
  }
}
export async function pairingProof(consumer:PairingIdentity,privateJWK:string|undefined,challenge:unknown){if(typeof challenge!=='string'||!/^[-\w]{43,100}$/.test(challenge))throw new PairingError(400,'invalid_request','Invalid identity challenge.');const key=await signingKey(privateJWK),payload=JSON.stringify({version:1,identity:consumer,challenge,publicKey:key.publicKey});return {payload,signature:await sign(payload,key.privateKey)};}
export function credential(value:Record<string,any>,issuer:PairingIdentity,consumer:PairingIdentity,siteOrigin:string,keyId:string):PairingCredential {
  if(value.version!==1||!value.issuer||!value.consumer||!samePairingIdentity(value.issuer,issuer)||!samePairingIdentity(value.consumer,consumer)||value.siteOrigin!==siteOrigin||value.scope!=='analytics:read'||value.keyId!==keyId||!/^[-\w]{64}$/.test(value.token)||!/^[-\w]{64}$/.test(value.grantId)||JSON.stringify(value.operations)!==JSON.stringify(['status','analytics']))throw new PairingError(503,'unavailable','The reporting credential identity could not be verified.');
  if(value.signOn!==undefined&&(!value.signOn||value.signOn.version!==1||typeof value.signOn.subjectId!=='string'||!value.signOn.subjectId||typeof value.signOn.approved!=='boolean'))throw new PairingError(503,'unavailable','Invalid named approval result');return {version:1,issuer,consumer,siteOrigin,grantId:value.grantId,token:value.token,keyId,scope:'analytics:read',operations:['status','analytics'],...(value.signOn?{signOn:{version:1,subjectId:value.signOn.subjectId,approved:value.signOn.approved}}:{})};
}
