import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const version=(JSON.parse(await readFile('packages/admin/package.json','utf8')) as {version:string}).version;
const directory=resolve('artifacts/releases',version);
const result=spawnSync(process.execPath,['--experimental-strip-types','--test','tests/package.test.ts'],{stdio:'inherit',env:{...process.env,VITRIS_RELEASE_DIRECTORY:directory},windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
