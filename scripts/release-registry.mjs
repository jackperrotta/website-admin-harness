export async function registryPackage(pkg,{request=fetch}={}){
  const url=`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response=await request(url,{headers:{'cache-control':'no-cache'}});
  if(response.status===404){await response.arrayBuffer();return null;}
  if(!response.ok)throw Error(`Cannot verify ${pkg.name}: registry HTTP ${response.status}`);
  const published=await response.json();
  if(published.name!==pkg.name||published.version!==pkg.version||published.dist?.integrity!==pkg.integrity)throw Error('Registry bytes do not match reviewed archive: '+pkg.name);
  return {name:pkg.name,version:pkg.version,integrity:published.dist.integrity,verified:true};
}

export async function waitForRegistry(pkg,{read=registryPackage,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=15*60*1000,intervalMs=15000,onPending=()=>{}}={}){
  const deadline=now()+timeoutMs;
  while(true){
    const result=await read(pkg);if(result)return result;
    if(now()>=deadline)throw Error(`${pkg.name} was accepted but is still processing. Re-run npm run release:publish later; its recorded upload will not be repeated.`);
    onPending(pkg);await sleep(Math.min(intervalMs,deadline-now()));
  }
}
