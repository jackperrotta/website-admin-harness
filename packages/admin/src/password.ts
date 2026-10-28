// Compatible with the existing Vitris PBKDF2 + HMAC verifier. No plaintext password storage.
type PasswordEnv={DB:D1Database;PASSWORD_LOGIN?:string;PASSWORD_PEPPER?:string};
type Credential={salt:string;tag:string;iterations:number;key_bits:number};
const bytes=(hex:string)=>Uint8Array.from(hex.match(/.{2}/g)||[],b=>parseInt(b,16));
export function passwordReady(env:PasswordEnv){return env.PASSWORD_LOGIN==='1' && typeof env.PASSWORD_PEPPER==='string' && env.PASSWORD_PEPPER.length>=32;}
export async function verifyPassword(env:PasswordEnv,userId:string,password:unknown):Promise<boolean>{
  const stored=await env.DB.prepare('SELECT salt,tag,iterations,key_bits FROM password_credentials WHERE user_id=?').bind(userId).first<Credential>();
  const supported=!!stored && /^[a-f0-9]{64}$/i.test(stored.salt) && /^[a-f0-9]{64}$/i.test(stored.tag) && stored.iterations===100000 && [256,1536].includes(stored.key_bits);
  const row=supported?stored!:{salt:'00'.repeat(32),tag:'00'.repeat(32),iterations:100000,key_bits:1536};
  const validInput=typeof password==='string' && password.length>0 && password.length<=256;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(validInput?password.normalize('NFC'):''),{name:'PBKDF2'},false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:row.iterations,salt:bytes(row.salt)},key,row.key_bits);
  const pepper=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PASSWORD_PEPPER || ''),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const verified=await crypto.subtle.verify('HMAC',pepper,bytes(row.tag),derived);
  return passwordReady(env) && supported && validInput && verified;
}
