import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {credentialIssue,privateFileIssue} from './publication-safety.ts';

const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const findings:string[]=[];
for(const file of new Set(files)){
  const pathIssue=privateFileIssue(file);if(pathIssue)findings.push(`${file}: ${pathIssue}`);
  try{const issue=credentialIssue(await readFile(file,'utf8'));if(issue)findings.push(`${file}: ${issue}`);}
  catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
}
// A cleaned working copy can still have a credential staged for the next commit.
const staged=execFileSync('git',['ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).map(entry=>{
  const tab=entry.indexOf('\t');return {object:entry.slice(0,tab).split(' ')[1],file:entry.slice(tab+1)};
});
// Drain Git output while writing input: synchronous bidirectional pipes can
// deadlock on Windows when the index contains many or large blobs.
if(staged.length){
  const ids=[...new Set(staged.map(entry=>entry.object))];
  const contents=await new Promise<Buffer>((resolve,reject)=>{
    const child=spawn('git',['cat-file','--batch'],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0;
    child.on('error',reject);child.stdin.on('error',reject);child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>64*1024*1024){child.kill();reject(Error('Git index exceeds privacy scan limit'));}else chunks.push(chunk);});
    child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(Error('Could not inspect Git index')));
    child.stdin.end(ids.join('\n')+'\n');
  });
  let cursor=0;
  for(const object of ids){
    const newline=contents.indexOf(10,cursor),header=contents.subarray(cursor,newline).toString('utf8').split(' '),size=Number(header[2]);
    if(newline<0||header[1]!=='blob'||!Number.isSafeInteger(size)||size<0)throw Error('Could not inspect Git index contents');
    const issue=credentialIssue(contents.subarray(newline+1,newline+1+size).toString('utf8'));
    if(issue)for(const entry of staged.filter(entry=>entry.object===object))findings.push(`${entry.file} (Git index): ${issue}`);
    cursor=newline+size+2;
  }
}
if(findings.length){console.error('Publication privacy check failed (matched values withheld):\n'+findings.join('\n'));process.exitCode=1;}
else console.log(`Publication privacy check passed: ${new Set(files).size} Git-eligible files; no recognized credentials or private file paths.`);
