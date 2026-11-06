export const reportingPairingVersion=1;
export const pairingBase='/api/webmaster-reporting/v1';
export const pairingMachineActions=['request','poll','exchange','report','rotate','revoke'] as const;
export type PairingMachineAction=typeof pairingMachineActions[number];
export const pairingPaths=Object.fromEntries(['capabilities','approval','approve','reject','grants','revoke-grant',...pairingMachineActions].map(action=>[action,pairingBase+'/'+action])) as Record<'capabilities'|'approval'|'approve'|'reject'|'grants'|'revoke-grant'|PairingMachineAction,string>;
export const pairingPolicy={requestLifetimeSeconds:600,receiptLifetimeSeconds:600,signatureSkewSeconds:90,analyticsDays:[14,30] as const};
export interface PairingStart {requestId:string;challenge:string}
export interface PairingExchange {requestId:string;code:string;verifier:string}
export interface PairingReportRequest {grantId:string;operation:'status'|'analytics';days?:14|30}
export interface PairingMutation {grantId:string;operationId:string}
export const reportingOperations=['status','analytics'] as const;
export interface PairingIdentity {installationId:string;siteId:string;adminOrigin:string}
export interface PairingPeer extends PairingIdentity {organizationId:string;organizationName:string}
export interface PairingConfiguration {trustedWebmasters:PairingPeer[]}
export interface PairingCapabilities {version:1;issuer:PairingIdentity;siteOrigin:string;operations:readonly ['status','analytics'];scope:'analytics:read';requestPath:string;approvalPath:string}
export interface PairingEnvelope {version:1;identity:PairingIdentity;target:string;path:string;time:number;nonce:string;tokenHash:string;request:Record<string,unknown>}
export interface PairingCredential {version:1;issuer:PairingIdentity;consumer:PairingIdentity;siteOrigin:string;grantId:string;token:string;keyId:string;scope:'analytics:read';operations:readonly ['status','analytics']}
export interface PairingGrantView {id:string;organizationId:string;organizationName:string;consumer:PairingIdentity;createdAt:number;lastUsedAt:number|null;revokedAt:number|null;revision:number}
export interface PairingRequestView {id:string;organizationName:string;consumer:PairingIdentity;issuer:PairingIdentity;expiresAt:number;status:'pending'|'approved'|'revoked'|'expired';scope:'analytics:read';createsRelationship:boolean}
export type PairingErrorCode='invalid_request'|'unauthorized'|'forbidden'|'expired'|'replay'|'conflict'|'unavailable'|'unsupported';
export function samePairingIdentity(a:PairingIdentity,b:PairingIdentity){return a.installationId===b.installationId&&a.siteId===b.siteId&&a.adminOrigin===b.adminOrigin;}
