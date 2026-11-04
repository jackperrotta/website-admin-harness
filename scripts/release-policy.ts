export interface ReleasePackageManifest {name:string;version:string;publishConfig?:{access:string;tag:string};dependencies?:Record<string,string>}
export const releasePackageNames=['@tryvitris/website-admin-contracts','@tryvitris/website-admin-harness','@tryvitris/create-website-admin-harness'];
export function stableRelease(manifests:ReleasePackageManifest[]){
  const version=manifests[0]?.version;
  if(!version||!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)||manifests.length!==releasePackageNames.length||manifests.some((manifest,index)=>manifest.name!==releasePackageNames[index]||manifest.version!==version||manifest.publishConfig?.access!=='public'||manifest.publishConfig?.tag!=='latest'))throw Error('Expected synchronized stable packages with public access and the latest tag');
  if(manifests[2].dependencies?.['@tryvitris/website-admin-harness']!==version)throw Error('Initializer must pin the matching stable runtime');
  return {version,tag:'latest' as const};
}
