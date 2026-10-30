import {isObject} from '../packages/contracts/src/index.ts';
import type {PackageIdentity, VerifiedPackage} from './release-types.ts';
export async function registryPackage(pkg: PackageIdentity,{request=fetch}: {request?: typeof fetch}={}): Promise<VerifiedPackage | null>{
  const url=`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response=await request(url,{headers:{'cache-control':'no-cache'}});
  if(response.status===404){await response.arrayBuffer();return null;}
  if(!response.ok)throw Error(`Cannot verify ${pkg.name}: registry HTTP ${response.status}`);
  const published: unknown=await response.json();
  if(!isObject(published)||published.name!==pkg.name||published.version!==pkg.version||!isObject(published.dist)||published.dist.integrity!==pkg.integrity)throw Error('Registry bytes do not match reviewed archive: '+pkg.name);
  return {name:pkg.name,version:pkg.version,integrity:published.dist.integrity,verified:true};
}

interface WaitOptions {
  read?: (pkg: PackageIdentity) => Promise<VerifiedPackage | null>; now?: () => number;
  sleep?: (ms: number) => Promise<void>; timeoutMs?: number; intervalMs?: number;
  onPending?: (pkg: PackageIdentity) => void;
}
export async function waitForRegistry(pkg: PackageIdentity,{read=registryPackage,now=Date.now,sleep=ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)),timeoutMs=15*60*1000,intervalMs=15000,onPending=()=>{}}: WaitOptions={}){
  const deadline=now()+timeoutMs;
  while(true){
    const result=await read(pkg);if(result)return result;
    if(now()>=deadline)throw Error(`${pkg.name} was accepted but is still processing. Re-run npm run release:publish later; its recorded upload will not be repeated.`);
    onPending(pkg);await sleep(Math.min(intervalMs,deadline-now()));
  }
}
