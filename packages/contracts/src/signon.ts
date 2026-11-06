import type {PairingIdentity} from './pairing.ts';
export const signOnVersion=1;
export const signOnBase='/api/webmaster-sso/v1';
export const signOnPolicy={flowSeconds:300,codeSeconds:60,approvalSeconds:600,sessionSeconds:28800,uiCheckMilliseconds:5000};
export type SignOnConfiguration={mode:'broker'}|{mode:'client';broker:PairingIdentity;subjectId:string;organizationId:string;publicKey:{kty:'EC';crv:'P-256';x:string;y:string}};
export interface SignOnAssertion {version:1;issuer:PairingIdentity;audience:PairingIdentity;subject:{id:string;email:string};lease:string;expiresAt:number;flowId:string}
export interface SignOnStatus {version:1;issuer:PairingIdentity;audience:PairingIdentity;nonce:string;leaseHash:string;subjectId:string;active:boolean;expiresAt:number;time:number}
export interface SignedSignOn {payload:string;signature:string}
