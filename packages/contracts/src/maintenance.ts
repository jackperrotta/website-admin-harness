/** Package maintenance is an agent workflow; this contract grants no deployment authority. */
export const maintenanceVersion = 1;
export const adminMaintenancePackages = ['@tryvitris/website-admin-harness', '@tryvitris/website-admin-contracts', '@tryvitris/create-website-admin-harness'] as const;
export const maintenancePackages = ['@tryvitris/website-admin-harness', '@tryvitris/website-admin-contracts', '@tryvitris/create-website-admin-harness', '@tryvitris/website-harness'] as const;
export type MaintenancePackage = typeof maintenancePackages[number];
export type MaintenanceStatus = 'not-declared' | 'current' | 'update-available' | 'ahead' | 'unmanaged' | 'drift' | 'unavailable';
export interface MaintenanceRelease {name: MaintenancePackage; version: string; integrity: string; tarball: string}
export interface MaintenanceEntry {
 name: MaintenancePackage; declared: string | null; installed: string | null; locked: string | null;
 status: MaintenanceStatus; change: 'none' | 'patch' | 'minor' | 'major' | 'unknown'; latest: MaintenanceRelease | null;
}
export interface MaintenanceReport {
 schemaVersion: 1; checkedAt: string; policy: 'prepare-and-test';
 adminRelease: {version: string | null; complete: boolean}; packages: MaintenanceEntry[];
 baseline: Record<string, string>; deployment: 'not-checked';
}
export interface MaintenancePlan {
 schemaVersion: 1; policy: 'prepare-and-test'; baseline: Record<string, string>;
 ready: boolean; held: MaintenancePackage[]; updates: MaintenanceRelease[];
 install: {command: 'npm'; args: string[]} | null;
 requiredChecks: string[]; deployment: 'follow-existing-permissions';
}
