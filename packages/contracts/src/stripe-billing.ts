/** Installation choices, supplied by trusted source rather than browser input. */
export interface StripeBillingConfig {
  accountId: string;
  mode: 'test' | 'live';
  currency: string;
  prices: string[];
  portalConfigurationId?: string;
  allowLiveWrites?: boolean;
  grants?: BillingAccountGrant[];
}
export interface BillingAccountGrant {id:string;tokenHash:string;customerId:string;installationId:string;siteId:string;adminOrigin:string;manage:boolean;enabled:boolean}
export interface BillingAccountConfig {sellerOrigin:string;sellerInstallationId:string;sellerSiteId:string;grantId:string;customerId:string;mode:'test'|'live'}
export interface StripeCustomer {id:string;name:string;email:string;stripeId:string;createdAt:number}
export interface StripePrice {id:string;name:string;amount:number;currency:string;interval:'month'|'year'|null;intervalCount:number}
export interface StripeRecord {id:string;customerId:string;kind:'invoice'|'subscription'|'checkout'|'payment';status:string;amount:number;paid:number;remaining:number;currency:string;label:string;date:number|null;cancelAtPeriodEnd:boolean;cancelAt?:number|null;priceIds:string[]}
export interface StripeInvoiceDraft {id:string;customerId:string;description:string;lines:{description:string;quantity:number;unitAmount:number}[];dueDays:number;revision:number;state:'draft'|'issuing'|'issued';stripeId:string|null}
export interface StripeBillingView {
  provider:'stripe';simulated:false;audience:'seller'|'customer';installationId:string;siteId:string;mode:'test'|'live';currency:string;business:string;
  setup:{configured:boolean;verified:boolean;webhookConfigured:boolean;liveWritesAllowed:boolean;verifiedAt:number|null};
  customers:StripeCustomer[];records:StripeRecord[];drafts:StripeInvoiceDraft[];prices:StripePrice[];
  operations:{id:string;kind:string;state:string;createdAt:number}[];
  sync:{pending:number;failed:number};
}
