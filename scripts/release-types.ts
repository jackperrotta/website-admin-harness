export interface PackageIdentity {name: string; version: string; integrity: string}
export interface VerifiedPackage extends PackageIdentity {verified: true}
export interface PackedPackage extends PackageIdentity {
  filename: string; size: number; files: {path: string; size: number; mode: number}[];
}
export interface ReleaseManifest {version: string; tag: string; packages: PackedPackage[]}
export interface PublicationProgress extends PackageIdentity {
  status: 'accepted' | 'verified'; acceptedAt?: string; verifiedAt?: string;
}
