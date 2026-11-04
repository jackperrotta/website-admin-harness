import {execFileSync} from 'node:child_process';
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
if(staged.length){
  const ids=[...new Set(staged.map(entry=>entry.object))],contents=execFileSync('git',['cat-file','--batch'],{input:ids.join('\n')+'\n',maxBuffer:64*1024*1024});
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
