/** Operational access never includes ownership, access administration or billing. */
export const webmasterScopes = ['analytics:read','settings:write','tasks:read','tasks:write','leads:read','leads:write'] as const;
export type WebmasterScope = typeof webmasterScopes[number];
export interface WebmasterMember {userId:string;permissions:WebmasterScope[]}
export interface WebmasterConnection {
  organizationId:string;organizationName:string;billingProvider:boolean;
  status:'connected'|'disconnected';revision:number;members:WebmasterMember[];permissions:WebmasterScope[];
}
export interface WebmasterResponse {
  connection:WebmasterConnection|null;canManage:boolean;
  eligibleUsers:Array<{id:string;email:string}>;
}
export function validWebmasterScopes(value:unknown):value is WebmasterScope[] {
  return Array.isArray(value)&&value.length<=webmasterScopes.length&&new Set(value).size===value.length&&value.every(p=>(webmasterScopes as readonly unknown[]).includes(p))&&(!value.includes('leads:write')||value.includes('leads:read'))&&(!value.includes('tasks:write')||value.includes('tasks:read'));
}
