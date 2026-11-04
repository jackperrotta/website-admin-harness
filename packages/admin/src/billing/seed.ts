import type {BillingState, BillingInvoice} from '../../../contracts/src/billing.ts';
export function billingSeed(): BillingState {
  const today = new Date();
  const day = (offset: number) => {const date = new Date(today); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);};
  const customers = [
    {id:'alder',name:'Alder & Stone',contact:'Morgan Ellis',email:'morgan@alder.example.test',initials:'AS',color:'#e6dccb',websites:['alder.example.test','journal.alder.example.test'],note:'Website care and ongoing studio support. Two websites on one account.'},
    {id:'sunday',name:'Sunday House',contact:'Taylor Reed',email:'taylor@sunday.example.test',initials:'SH',color:'#eddbd0',websites:['sunday.example.test'],note:'Seasonal hospitality updates and monthly care.'},
    {id:'northline',name:'Northline Studio',contact:'Alex Chen',email:'alex@northline.example.test',initials:'NS',color:'#d7e1e5',websites:['northline.example.test'],note:'Payment needs attention. Contact the account owner before changing service.'},
    {id:'fieldwork',name:'Fieldwork',contact:'Jordan Avery',email:'jordan@fieldwork.example.test',initials:'F',color:'#dde3ce',websites:['fieldwork.example.test'],note:'Annual website care. Renewal reminder requested.'},
    {id:'form',name:'Form & Function',contact:'Casey Lane',email:'casey@form.example.test',initials:'FF',color:'#e2dcE8',websites:['form.example.test'],note:'Subscription ends at the close of the current billing period.'},
  ];
  const plans = [
    {id:'essential',name:'Essential care',description:'A healthy website, looked after.',amount:9900,interval:'month' as const,features:['Hosting & security','Monthly health checks','Email support'],selfService:true},
    {id:'studio',name:'Studio care',description:'Room for your website to grow.',amount:24900,interval:'month' as const,features:['Everything in Essential','Content updates','Monthly analytics review','Priority support'],selfService:true},
    {id:'partner',name:'Growth partner',description:'An ongoing partner for your business.',amount:49900,interval:'month' as const,features:['Everything in Studio','Strategy & improvements','Campaign landing pages','Dedicated monthly check-in'],selfService:true},
    {id:'annual',name:'Essential annual',description:'A year of care, paid once.',amount:99000,interval:'year' as const,features:['Essential care for 12 months','Two months included'],selfService:true},
  ];
  const invoice = (id: string, customerId: string, description: string, amount: number, status: BillingInvoice['status'], offset: number, kind: BillingInvoice['kind'] = 'subscription'): BillingInvoice => ({id,customerId,number:`INV-${String(1040+Number(id.slice(4))).padStart(4,'0')}`,description,lines:[{description,quantity:1,unitAmount:amount}],status,issued:day(offset-14),due:day(offset),paidAt:status==='paid'?day(offset):null,kind});
  const invoices = [invoice('inv-1','alder','Studio care · this month',24900,'paid',-3),invoice('inv-2','alder','Seasonal website refresh',65000,'open',7,'one_off'),invoice('inv-3','sunday','Growth partner · this month',49900,'paid',-2),invoice('inv-4','northline','Studio care · this month',24900,'open',-6),invoice('inv-5','fieldwork','Essential annual',99000,'paid',-10),invoice('inv-6','form','Essential care · this month',9900,'paid',-1),invoice('inv-7','sunday','Photography page update',35000,'draft',14,'one_off'),invoice('inv-8','alder','Studio care · previous month',24900,'paid',-33),invoice('inv-9','alder','Brand launch support',80000,'paid',-38,'one_off')];
  for(let month=2;month<=5;month++)for(const [index,id] of ['alder','sunday','form'].entries())invoices.push(invoice(`inv-${10+(month-2)*3+index}`,id,'Monthly website care',index===0?24900:index===1?49900:9900,'paid',-month*30));
  return {customers,plans,subscriptions:[
    {id:'sub-alder',customerId:'alder',planId:'studio',status:'active',renewal:day(25),cancelAtPeriodEnd:false,scheduledPlanId:null},
    {id:'sub-sunday',customerId:'sunday',planId:'partner',status:'active',renewal:day(12),cancelAtPeriodEnd:false,scheduledPlanId:null},
    {id:'sub-northline',customerId:'northline',planId:'studio',status:'past_due',renewal:day(24),cancelAtPeriodEnd:false,scheduledPlanId:null},
    {id:'sub-fieldwork',customerId:'fieldwork',planId:'annual',status:'active',renewal:day(340),cancelAtPeriodEnd:false,scheduledPlanId:null},
    {id:'sub-form',customerId:'form',planId:'essential',status:'active',renewal:day(8),cancelAtPeriodEnd:true,scheduledPlanId:null},
  ],invoices,payments:[...invoices.filter(i=>i.status==='paid').map(i=>({id:`pay-${i.id}`,customerId:i.customerId,invoiceId:i.id,amount:i.lines[0].unitAmount,status:'succeeded' as const,date:i.paidAt!})),{id:'pay-failed',customerId:'northline',invoiceId:'inv-4',amount:24900,status:'failed',date:day(-6)}],
  activity:[{id:'event-1',customerId:'sunday',text:'Sunday House paid their monthly subscription.',at:day(-1)},{id:'event-2',customerId:'northline',text:'A renewal payment needs attention.',at:day(-2)},{id:'event-3',customerId:'form',text:'Cancellation scheduled for the end of the billing period.',at:day(-3)}],connection:true,card:{brand:'Visa',last4:'4242',expiry:'12 / 2028'}};
}
