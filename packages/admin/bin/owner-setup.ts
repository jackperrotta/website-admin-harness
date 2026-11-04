import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {parseManifest} from '../../contracts/src/index.ts';

/** Prepare a designated owner; never create an active account or send mail here. */
export async function ownerSetup(root:string,address:unknown){
 if(typeof address!=='string'||address.length>254||!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(address))throw Error('Provide a valid --email for the first owner');
 const manifest=parseManifest(JSON.parse(await readFile(join(root,'admin.config.json'),'utf8')));
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
 const sql=`-- Apply only to this installation's dedicated database after migration 0009.\n-- This fails if users already exist; it never promotes or replaces an account.\nINSERT INTO auth_owner_setup(installation_id,admin_origin,email) VALUES(${quote(manifest.installationId)},${quote(manifest.adminOrigin)},${quote(address.toLowerCase())});\n`;
 const output=join(root,'.vitris/owner-setup.sql');await mkdir(dirname(output),{recursive:true});
 try{await writeFile(output,sql,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(output,'utf8')!==sql)throw Error('A different owner setup file exists. Review it explicitly before changing the designated owner.');}
 console.log(`Owner setup SQL prepared at ${output}. Review and apply to the intended dedicated database, then open ${manifest.adminOrigin}/account/setup to request the owner email. No account was created and no email was sent.`);
}
