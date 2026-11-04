export const clientOnboardingPermissions = ['prospects:read', 'prospects:write'] as const;
export interface OnboardingField {id: string; label: string; required: boolean; value: string; kind?: 'text' | 'textarea' | 'tel' | 'url'; section?: 'business' | 'website'; help?: string}
export interface OnboardingTemplate {
  id: string; name: string; businessType: string; title: string; intro: string; message: string;
  fields: OnboardingField[]; requiresPayment: boolean; revision: number; updatedAt: string | null; source: 'starter' | 'saved';
}
export interface OnboardingConfig {templateId?: string; templateName?: string; templateRevision?: number; title: string; intro: string}
export interface OnboardingDraft {name?: string; fields?: OnboardingField[]; step?: 'business' | 'website' | 'account'; savedAt?: string}
export interface Prospect {
  id: string; business: string; name: string; email: string; previewUrl: string; message: string;
  status: 'draft' | 'invited' | 'expired' | 'active' | 'revoked';
  createdAt: string; invitedAt: string | null; expiresAt: string | null; activatedAt: string | null;
  feedback: string; feedbackAt: string | null;
  fields: OnboardingField[]; requiresPayment: boolean; paymentStatus: 'not_requested' | 'pending' | 'demo_complete';
  onboarding?: OnboardingConfig;
}
export interface ProspectWorkspace {rows: Prospect[]; templates: OnboardingTemplate[]; localOnly: true; delivery: 'copy-link'}
export type ProspectPortal = Pick<Prospect, 'business' | 'name' | 'email' | 'previewUrl' | 'message' | 'feedback' | 'feedbackAt' | 'fields' | 'requiresPayment' | 'paymentStatus'> & {onboarding?: Pick<OnboardingConfig, 'title' | 'intro'>; draft?: OnboardingDraft; inviteId?: string};

export function normalizeOnboardingFields(value: unknown): OnboardingField[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const result: OnboardingField[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const f = item as Record<string, unknown>;
    if (typeof f.id !== 'string' || !/^[\w-]{1,60}$/.test(f.id) || result.some(v => v.id === f.id) || typeof f.label !== 'string' || !f.label.trim() || f.label.trim().length > 80 || typeof f.required !== 'boolean' || typeof f.value !== 'string' || f.value.trim().length > 1000 || f.kind !== undefined && !['text','textarea','tel','url'].includes(String(f.kind)) || f.section !== undefined && !['business','website'].includes(String(f.section)) || f.help !== undefined && (typeof f.help !== 'string' || f.help.length > 180)) return null;
    result.push({id:f.id,label:f.label.trim(),required:f.required,value:f.value.trim(),...(f.kind ? {kind:f.kind as OnboardingField['kind']} : {}),...(f.section ? {section:f.section as OnboardingField['section']} : {}),...(f.help ? {help:String(f.help).trim()} : {})});
  }
  return result;
}
export function onboardingFieldError(field: OnboardingField): string | null {
  if (!field.value.trim()) return field.required ? 'Please complete this field.' : null;
  if (field.kind === 'tel' && field.value.replace(/[^0-9]/g,'').length < 5) return 'Enter a phone number.';
  if (field.kind === 'url') {try {const u=new URL(field.value); if (!['http:','https:'].includes(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return 'Enter a complete website URL.';} catch {return 'Enter a complete website URL, including https://.';}}
  return null;
}
export function onboardingAnswersMatch(answers: OnboardingField[], original: OnboardingField[], complete = false): boolean {
  return answers.length === original.length && original.every(f => answers.some(a => a.id === f.id && a.label === f.label && a.required === f.required && (a.kind || 'text') === (f.kind || 'text') && (a.section || 'business') === (f.section || 'business') && (a.help || '') === (f.help || '') && (!complete || !onboardingFieldError(a))));
}
