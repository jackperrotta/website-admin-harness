import {parseManifest} from '../../contracts/src/index.ts';
import {AccountService,type AccountEnv,type AuthEmailMessage} from './accounts.ts';

/** Deploy without routes, workers.dev or preview URLs; bind only the matching Pages project. */
export function createAccountMailWorker(input:unknown){
 const manifest=parseManifest(input);
 return {
  async fetch(request:Request,env:AccountEnv):Promise<Response>{
   const url=new URL(request.url);
   if(url.origin!=='https://vitris-account-mail.internal'||url.pathname!=='/send'||request.method!=='POST')return new Response('Not found',{status:404});
   const accounts=new AccountService(env,manifest);
   if(!accounts.mailReady)return new Response('Account email is not ready',{status:503});
   if(!request.headers.get('content-type')?.startsWith('application/json'))return new Response('JSON is required',{status:415});
   const reader=request.body?.getReader();if(!reader)return new Response('Body is required',{status:400});
   const chunks:Uint8Array[]=[];let length=0;
   for(;;){const result=await reader.read();if(result.done)break;length+=result.value.length;if(length>8192){await reader.cancel();return new Response('Request too large',{status:413});}chunks.push(result.value);}
   const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
   let message:AuthEmailMessage;
   try{const value=JSON.parse(new TextDecoder().decode(all)) as Partial<AuthEmailMessage>;
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['to','from','subject','text'].includes(k))||typeof value.from!=='string'||value.from!==env.AUTH_FROM||typeof value.to!=='string'||value.to.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.to)||typeof value.subject!=='string'||value.subject.length>300||/[\r\n]/.test(value.subject)||!value.subject.includes(manifest.business.name.replace(/[\r\n]+/g,' ').slice(0,100))||typeof value.text!=='string'||value.text.length>6000||!value.text.includes(manifest.adminOrigin))throw Error();
    message={to:value.to,from:value.from,subject:value.subject,text:value.text};
   }catch{return new Response('Invalid account message',{status:400});}
   try{await env.AUTH_EMAIL!.send(message);return Response.json({ok:true});}
   catch{return new Response('Account mail was not accepted',{status:502});}
  },
  async scheduled(_controller:ScheduledController,env:AccountEnv){await new AccountService(env,manifest).tick();},
 };
}
