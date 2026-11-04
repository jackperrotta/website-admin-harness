import {createAdmin,type AdminEnv,type AdminModule} from './worker.ts';
import type {AuthEmailMessage} from './accounts.ts';

export interface PagesAdminEnv extends AdminEnv {AUTH_MAIL_SERVICE?:Pick<Fetcher,'fetch'>}
/** Pages keeps its existing authentication secrets; only mail crosses the private binding. */
export function createPagesAdmin(input:unknown,options:{modules?:AdminModule[]}={}){
 const app=createAdmin(input,options);
 return {fetch(request:Request,env:PagesAdminEnv,context?:ExecutionContext){
  const mail=env.AUTH_MAIL_SERVICE;
  return app.fetch(request,mail?{...env,AUTH_EMAIL:{async send(message:AuthEmailMessage){
   const response=await mail.fetch('https://vitris-account-mail.internal/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message)});
   if(!response.ok)throw Error('Account mail service did not accept the message');
  }}}:env,context);
 }};
}
