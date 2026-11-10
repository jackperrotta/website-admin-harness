import {searchTypes,searchDimensions,type SearchQuery} from '../../../contracts/src/search-console.ts';
import {SearchConsoleError} from './types.ts';
function fail(status:number,code:string,message:string):never{throw new SearchConsoleError(status,code,message);}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function searchWindow(days=28):{startDate:string;endDate:string}{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()-3);
  return {startDate:new Date(end.getTime()-(days-1)*86400000).toISOString().slice(0,10),endDate:end.toISOString().slice(0,10)};
}
export function parseSearchQuery(v:unknown):SearchQuery {
  if(!record(v)||!date(v.startDate)||!date(v.endDate)||v.startDate>v.endDate||Date.parse(v.endDate)-Date.parse(v.startDate)>550*86400000)fail(400,'invalid_query','Use a valid date range of at most 551 days.');
  const q=v as Record<string,unknown>;
  const type=q.type??'web',dimensions=q.dimensions??['date'],rowLimit=q.rowLimit??1000,startRow=q.startRow??0,dataState=q.dataState??'final';
  if(!searchTypes.includes(type as never)||!Array.isArray(dimensions)||dimensions.some(d=>!searchDimensions.includes(d as never))||new Set(dimensions).size!==dimensions.length||!Number.isInteger(rowLimit)||Number(rowLimit)<1||Number(rowLimit)>1000||!Number.isInteger(startRow)||Number(startRow)<0||Number(startRow)>1000000||!['final','all','hourly_all'].includes(String(dataState)))fail(400,'invalid_query','Invalid type, dimensions, data state or pagination. Request up to 1,000 rows per page.');
  if((type==='discover'||type==='googleNews')&&dimensions.includes('query'))fail(400,'invalid_query','Discover and Google News do not provide search queries.');
  if(dimensions.includes('hour')&&dataState!=='hourly_all'||dataState==='hourly_all'&&!dimensions.includes('hour'))fail(400,'invalid_query','Hourly reports require the hour dimension and hourly_all data state.');
  let groups:SearchQuery['dimensionFilterGroups'];
  if(q.dimensionFilterGroups!==undefined){
    if(!Array.isArray(q.dimensionFilterGroups)||q.dimensionFilterGroups.length>5)fail(400,'invalid_filters','Invalid filter groups.');
    groups=(q.dimensionFilterGroups as unknown[]).map(g=>{
      if(!record(g)||g.groupType!=='and'||!Array.isArray(g.filters)||!g.filters.length||g.filters.length>10)fail(400,'invalid_filters','Use bounded AND filter groups.');
      return {groupType:'and',filters:((g as Record<string,unknown>).filters as unknown[]).map(f=>{
        if(!record(f)||!['query','page','country','device','searchAppearance'].includes(String(f.dimension))||!['contains','equals','notContains','notEquals','includingRegex','excludingRegex'].includes(String(f.operator))||typeof f.expression!=='string'||f.expression.length>4096)fail(400,'invalid_filters','Invalid search filter.');
        if((type==='discover'||type==='googleNews')&&(f as Record<string,unknown>).dimension==='query')fail(400,'invalid_filters','This report does not provide search queries.');
        return f as {dimension:string;operator:string;expression:string};
      })};
    });
  }
  return {startDate:q.startDate as string,endDate:q.endDate as string,type:type as SearchQuery['type'],dimensions:dimensions as string[],rowLimit:Number(rowLimit),startRow:Number(startRow),dataState:dataState as SearchQuery['dataState'],...(groups?{dimensionFilterGroups:groups}:{})};
}
/** Only the exact website URL prefix, or a domain containing it, can be selected. */
export function matchingProperty(property:string,origin:string):boolean {
  if(property.startsWith('sc-domain:')){const domain=property.slice(10);const host=new URL(origin).hostname;return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)&&!domain.includes('..')&&(host===domain||host.endsWith('.'+domain));}
  try{return property===new URL(origin).origin+'/';}catch{return false;}
}
