export const searchTypes = ['web','image','video','news','discover','googleNews'] as const;
export const searchDimensions = ['date','hour','query','page','country','device','searchAppearance'] as const;
export type SearchType = typeof searchTypes[number];
export interface SearchQuery {
  startDate:string; endDate:string; type:SearchType;
  dimensions:string[]; rowLimit:number; startRow:number;
  dataState:'final'|'all'|'hourly_all';
  dimensionFilterGroups?:{groupType:'and';filters:{dimension:string;operator:string;expression:string}[]}[];
}
export interface SearchRow {keys?:string[];clicks:number;impressions:number;ctr:number;position?:number}
export interface SearchReport {
  source:'google-search-console'; property:string; timezone:'America/Los_Angeles';
  request:SearchQuery; rows:SearchRow[]; fetchedAt:string; nextStartRow:number|null;
  responseAggregationType?:string; metadata?:unknown; persisted:boolean;
  limitations:string[];
}
export interface SearchConsoleStatus {
  configured:boolean; connected:boolean; property:string|null; revision:number; canSubmitSitemaps:boolean;
  lastSyncedAt:string|null; error:string|null;
}
export interface SearchConsoleAppSettings {
  revision:number; clientId:string; clientSecretSet:boolean; encryptionReady:boolean;
  redirectUri:string; source:'admin'|'environment'|'not-configured';
}
export const searchLimitations = [
  'Google returns available top rows and omits anonymized queries. Query and page breakdowns need not add up to property totals.',
  'Daily reports use Pacific time. Final data can lag; fresh and hourly data can be incomplete.',
  'Search clicks and impressions are separate from website visits and enquiries. The API does not expose every Search Console report.',
];
