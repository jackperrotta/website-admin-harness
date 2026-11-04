import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

/** Never include matched content in diagnostics: it may itself be a credential. */
export function credentialIssue(content:string):string|undefined {
  const patterns:[string,RegExp][]=[
    ['Stripe secret/restricted key',/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/],
    ['Stripe webhook signing secret',/\bwhsec_[A-Za-z0-9]{20,}/],
    ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
    ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ];
  return patterns.find(([,pattern])=>pattern.test(content))?.[0];
}

export function privateFileIssue(file:string):string|undefined {
  const path=file.replaceAll('\\','/');
  if(/(^|\/)(\.vitris|\.wrangler|artifacts)(\/|$)/.test(path))return 'private working directory';
  if(/(^|\/)(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$))|\.env$|\.sqlite(?:-\w+)?$|\.private(?:\.|$)|\.tgz$/.test(path))return 'private environment, evidence or archive file';
  return undefined;
}

/** Inspect the actual archive, including contents that differ from current source. */
export async function assertSafeArchive(archive:string):Promise<void> {
  const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(Boolean);
  for(const entry of entries){
    if(!entry.startsWith('package/')||entry.split('/').includes('..'))throw Error('Unexpected archive path');
    const issue=privateFileIssue(entry);
    if(issue)throw Error(`Unsafe package file (${issue}): ${entry}`);
  }
  const issue=credentialIssue(gunzipSync(await readFile(archive)).toString('utf8'));
  if(issue)throw Error(`Package blocked: ${issue} detected in archive contents`);
}
