import {normalizeOnboardingFields, type OnboardingTemplate} from '../../../contracts/src/client-onboarding.ts';

export const defaultOnboardingTitle = 'Let’s make it yours.';
export const defaultOnboardingIntro = 'A few thoughtful details will help us shape a website that feels like your business.';
const welcome = 'Here’s a first look at your website. Explore the preview, then let’s make it yours.';
const starter = (id: string, name: string, businessType: string, fields: OnboardingTemplate['fields']): OnboardingTemplate => ({id, name, businessType, title: defaultOnboardingTitle, intro: defaultOnboardingIntro, message: welcome, fields, requiresPayment:true, revision:1, updatedAt:null, source:'starter'});
export const onboardingStarters: OnboardingTemplate[] = [
  starter('starter-services','Professional services','Consultants, studios & independent practices',[
    {id:'phone',label:'Business phone',kind:'tel',section:'business',required:true,value:''},
    {id:'address',label:'Business address',section:'business',required:true,value:''},
    {id:'services',label:'What do you help your clients with?',kind:'textarea',section:'website',help:'Tell us about your main services and who they are for.',required:true,value:''},
    {id:'goals',label:'What should your website help you achieve?',kind:'textarea',section:'website',required:false,value:''},
  ]),
  starter('starter-home','Home & construction','Builders, remodelers & home service businesses',[
    {id:'phone',label:'Business phone',kind:'tel',section:'business',required:true,value:''},
    {id:'areas',label:'Which areas do you serve?',section:'business',help:'Cities, neighborhoods, or the radius you work within.',required:true,value:''},
    {id:'specialties',label:'What kind of projects are your specialty?',kind:'textarea',section:'website',required:true,value:''},
    {id:'difference',label:'What should a homeowner know about your business?',kind:'textarea',section:'website',required:false,value:''},
  ]),
  starter('starter-hospitality','Hospitality & experiences','Places to stay, eat & discover',[
    {id:'phone',label:'Guest contact number',kind:'tel',section:'business',required:true,value:''},
    {id:'location',label:'Where can guests find you?',section:'business',required:true,value:''},
    {id:'experience',label:'What makes a visit to you special?',kind:'textarea',section:'website',required:true,value:''},
    {id:'booking',label:'Existing booking website',kind:'url',section:'website',required:false,value:''},
  ]),
];
export function parseOnboardingTemplate(data: Record<string, unknown>): Omit<OnboardingTemplate,'id'|'revision'|'updatedAt'|'source'> | null {
  const bounded = (v: unknown, max: number, required = false) => typeof v === 'string' && v.trim().length <= max && (!required || !!v.trim()) ? v.trim() : null;
  const name=bounded(data.name,100,true), businessType=bounded(data.businessType,160), title=bounded(data.title,100,true), intro=bounded(data.intro,400), message=bounded(data.message,1500), fields=normalizeOnboardingFields(data.fields);
  if (!name || businessType === null || !title || intro === null || message === null || !fields || typeof data.requiresPayment !== 'boolean') return null;
  return {name,businessType,title,intro,message,fields:fields.map(f=>({...f,value:''})),requiresPayment:data.requiresPayment};
}
