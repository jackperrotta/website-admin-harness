/** Cloudflare-only customer communications. Newsletter content is draft-only. */
export const emailCampaignPermissions = ['email-campaigns:read', 'email-reports:read', 'email-contacts:read', 'email-contacts:write', 'email-contacts:export', 'email-content:write', 'email-campaigns:send', 'email-automations:manage', 'email-settings:manage'] as const;
export type EmailPermission = typeof emailCampaignPermissions[number];
export const emailPurposes = ['customer-report', 'service-update', 'enquiry-response', 'newsletter-draft'] as const;
export type EmailPurpose = typeof emailPurposes[number];
export type EmailTopic = 'reports' | 'service' | 'newsletter';
export interface EmailModuleConfig {
    feedbackQueue: string;
    accountId?: string;
    zoneId?: string;
    sendingDomain?: string;
    eventSubscriptionId?: string;
    dailyLimit?: number;
}
export interface EmailSettings {
    enabled: boolean;
    mode: 'capture' | 'send';
    senderName: string;
    logoUrl: string;
    replyTo: string;
    postalAddress: string;
    accent: string;
    timezone: string;
    perMinute: number;
    dailyLimit: number;
    monthlyLimit: number;
    recipientCap: number;
    spacingHours: number;
    otherAccountEmails: number;
    reservedDaily: number;
    clickTracking: boolean;
}
export const defaultEmailSettings = (): EmailSettings => ({ enabled: false, mode: 'capture', senderName: '', logoUrl: '', replyTo: '', postalAddress: '', accent: '#245c50', timezone: 'America/New_York', perMinute: 50, dailyLimit: 500, monthlyLimit: 3000, recipientCap: 5000, spacingHours: 24, otherAccountEmails: 0, reservedDaily: 50, clickTracking: false });
export interface EmailContact {
    id: string;
    revision: number;
    email: string;
    name: string;
    company: string;
    stage: string;
    tags: string[];
    fields: Record<string, string>;
    source: string;
    interactionRef: string;
    serviceRef: string;
    topics: Partial<Record<EmailTopic, boolean>>;
    evidence: string;
    deleted?: boolean;
}
export interface EmailRule {
    field: string;
    op: 'eq' | 'neq' | 'contains' | 'exists' | 'not_exists';
    value: string;
}
export interface EmailSegment {
    id: string;
    revision: number;
    name: string;
    match: 'all' | 'any';
    rules: EmailRule[];
}
export interface EmailBlock {
    type: 'heading' | 'paragraph' | 'button' | 'image' | 'divider';
    text: string;
    url?: string;
    alt?: string;
}
export interface EmailTemplate {
    id: string;
    revision: number;
    name: string;
    layout: 'letter' | 'newsletter' | 'report' | 'update';
    subject: string;
    preheader: string;
    blocks: EmailBlock[];
}
export interface EmailCampaign {
    id: string;
    revision: number;
    name: string;
    purpose: EmailPurpose;
    templateId: string;
    segmentId: string;
    excludeIds: string[];
    scheduledAt: string;
    status: 'draft' | 'preparing' | 'scheduled' | 'running' | 'paused' | 'cancelled' | 'completed';
    snapshot?: EmailTemplate;
    audienceCutoff?: number;
    cursor?: string;
    approvedBy?: string;
    approvalRevision?: number;
    recurrenceDays?: number;
    nextIssueAt?: number;
    sourceArticle?: string;
}
export type EmailStep = {
    type: 'wait';
    minutes: number;
} | {
    type: 'send';
    templateId: string;
} | {
    type: 'condition';
    rule: EmailRule;
    skip: number;
} | {
    type: 'tag';
    value: string;
} | {
    type: 'stage';
    value: string;
} | {
    type: 'task';
    title: string;
} | {
    type: 'exit';
};
export interface EmailAutomation {
    id: string;
    revision: number;
    name: string;
    trigger: 'lead.created' | 'service.updated' | 'report.ready' | 'manual' | 'subscription.confirmed';
    purpose: EmailPurpose;
    status: 'draft' | 'active' | 'paused';
    steps: EmailStep[];
    version?: number;
    publisherId?: string;
    hasDraft?: boolean;
}
export interface EmailWebsiteEvent {
    version: 1;
    mode: 'production'|'test';
    id: string;
    installationId: string;
    siteId: string;
    type: 'lead.created' | 'service.updated' | 'report.ready' | 'customer.converted' | 'enquiry.resolved' | 'subscription.confirmed';
    occurredAt: string;
    /** Optional campaign attribution, verified against an actual live message to this contact. */
    campaignId?: string;
    contact: {
        email: string;
        name: string;
        company?: string;
        interactionRef?: string;
        serviceRef?: string;
    };
    report?: {
        title: string;
        period: string;
        summary: string;
        url?: string;
    };
}
export interface EmailRecord<T> {
    id: string;
    revision: number;
    data: T;
    createdAt: number;
    updatedAt: number;
}
export interface EmailJob {
    id: string;
    campaignId: string;
    contactId: string;
    state: string;
    reason: string | null;
    mode: 'capture' | 'send';
    dueAt: number;
    createdAt: number;
    providerMessageId: string | null;
}
export interface EmailWorkspace {
    settings: EmailRecord<EmailSettings>;
    readiness: {
        schemaReady: boolean;
        keysReady: boolean;
        senderReady: boolean;
        liveReady: boolean;
        feedbackReady: boolean;
        websiteReady: boolean;
        deliveryPaused: boolean;
        deliveryReason: string;
        from: string;
        issues: string[];
    };
    permissions: EmailPermission[];
    counts: Record<string, number>;
    monthly: {
        counted: number;
        estimatedOverage: number;
        included: number;
    };
    templates: EmailTemplate[];
}
export class EmailInputError extends Error {
    constructor(message: string) { super(message); this.name = 'EmailInputError'; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) && !/[\u0000-\u001f\u007f]/.test(v);
export const emailId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
function string(v: unknown, max: number, empty = true): string { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))
    throw new EmailInputError('Enter a valid text value.'); return v.trim(); }
function integer(v: unknown, min: number, max: number): number { if (!Number.isInteger(v) || Number(v) < min || Number(v) > max)
    throw new EmailInputError(`Use a whole number from ${min} to ${max}.`); return Number(v); }
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T))
    throw new EmailInputError('Choose a supported option.'); return v as T; }
function common(v: Record<string, unknown>) { return { id: v.id === undefined ? '' : (v.id === '' ? '' : emailId(v.id) ? v.id : (() => { throw new EmailInputError('Invalid record ID.'); })()), revision: integer(v.revision ?? 0, 0, 1e8) }; }
export function safeEmailUrl(v: unknown): string { const value = string(v, 2000, false); try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) || u.username || u.password)
        throw Error();
    return u.href;
}
catch {
    throw new EmailInputError('Use an absolute HTTPS link.');
} }
export function parseEmailRule(v: unknown): EmailRule { if (!object(v) || typeof v.field !== 'string' || !/^((stage|tag|source|company|service|interaction|topic|event)|custom\.[a-zA-Z][a-zA-Z0-9_-]{0,30})$/.test(v.field))
    throw new EmailInputError('Choose a supported segment field.'); return { field: v.field, op: choice(v.op, ['eq', 'neq', 'contains', 'exists', 'not_exists']), value: string(v.value ?? '', 300) }; }
export function parseEmailContact(v: unknown): EmailContact {
    if (!object(v) || !validEmail(v.email))
        throw new EmailInputError('Enter a valid contact email.');
    if (!Array.isArray(v.tags) || v.tags.length > 30 || !object(v.fields) || Object.keys(v.fields).length > 20 || !object(v.topics))
        throw new EmailInputError('Use at most 30 tags and 20 custom fields.');
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(v.fields)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/.test(key))
            throw new EmailInputError('Invalid custom field name.');
        fields[key] = string(value, 500);
    }
    const topics: EmailContact['topics'] = {};
    for (const [key, value] of Object.entries(v.topics)) {
        if (!['reports', 'service', 'newsletter'].includes(key) || typeof value !== 'boolean')
            throw new EmailInputError('Invalid topic preference.');
        topics[key as EmailTopic] = value;
    }
    return { ...common(v), email: v.email.trim(), name: string(v.name ?? '', 150), company: string(v.company ?? '', 150), stage: string(v.stage ?? 'lead', 50, false), tags: [...new Set(v.tags.map(t => string(t, 60, false)))], fields, source: string(v.source ?? 'manual', 100), interactionRef: string(v.interactionRef ?? '', 200), serviceRef: string(v.serviceRef ?? '', 200), topics, evidence: string(v.evidence ?? '', 1000) };
}
export function parseEmailSegment(v: unknown): EmailSegment { if (!object(v) || !Array.isArray(v.rules) || v.rules.length > 16)
    throw new EmailInputError('Use at most 16 segment rules.'); return { ...common(v), name: string(v.name, 150, false), match: choice(v.match, ['all', 'any']), rules: v.rules.map(parseEmailRule) }; }
export function parseEmailTemplate(v: unknown): EmailTemplate {
    if (!object(v) || !Array.isArray(v.blocks) || v.blocks.length < 1 || v.blocks.length > 40)
        throw new EmailInputError('Use 1 to 40 content sections.');
    const subject = string(v.subject, 250, false);
    if (/[\r\n]/.test(subject))
        throw new EmailInputError('Subject must be one line.');
    return { ...common(v), name: string(v.name, 150, false), layout: choice(v.layout, ['letter', 'newsletter', 'report', 'update']), subject, preheader: string(v.preheader ?? '', 250), blocks: v.blocks.map(b => { if (!object(b))
            throw new EmailInputError('Invalid content section.'); const type = choice(b.type, ['heading', 'paragraph', 'button', 'image', 'divider']); const url = b.url ? safeEmailUrl(b.url) : undefined; if ((type === 'button' || type === 'image') && !url)
            throw new EmailInputError('Buttons and images need an HTTPS link.'); return { type, text: string(b.text ?? '', 5000), ...(url ? { url } : {}), ...(type === 'image' ? { alt: string(b.alt ?? '', 300, false) } : {}) }; }) };
}
export function parseEmailCampaign(v: unknown): EmailCampaign { if (!object(v) || !emailId(v.templateId) || v.segmentId !== '' && !emailId(v.segmentId) || !Array.isArray(v.excludeIds) || v.excludeIds.length > 500 || v.excludeIds.some(x => !emailId(x)))
    throw new EmailInputError('Choose a template, audience, and valid exclusions.'); let scheduledAt = string(v.scheduledAt ?? '', 40); if (scheduledAt && (!/Z$/.test(scheduledAt) || !Number.isFinite(Date.parse(scheduledAt))))
    throw new EmailInputError('Schedule with an absolute UTC date.'); return { ...common(v), name: string(v.name, 150, false), purpose: choice(v.purpose, emailPurposes), templateId: v.templateId, segmentId: v.segmentId, excludeIds: v.excludeIds as string[], scheduledAt, status: 'draft', recurrenceDays: integer(v.recurrenceDays ?? 0, 0, 365), ...(v.sourceArticle ? { sourceArticle: safeEmailUrl(v.sourceArticle) } : {}) }; }
export function parseEmailAutomation(v: unknown): EmailAutomation {
    if (!object(v) || !Array.isArray(v.steps) || !v.steps.length || v.steps.length > 12)
        throw new EmailInputError('Use 1 to 12 forward-only steps.');
    const steps: EmailStep[] = v.steps.map((s, index) => { if (!object(s))
        throw new EmailInputError('Invalid automation step.'); switch (s.type) {
        case 'wait': return { type: s.type, minutes: integer(s.minutes, 1, 43200) };
        case 'send':
            if (!emailId(s.templateId))
                throw new EmailInputError('Choose a send template.');
            return { type: s.type, templateId: s.templateId };
        case 'condition': return { type: s.type, rule: parseEmailRule(s.rule), skip: integer(s.skip, 1, 12 - index) };
        case 'tag':
        case 'stage': return { type: s.type, value: string(s.value, 60, false) };
        case 'task': return { type: s.type, title: string(s.title, 180, false) };
        case 'exit': return { type: s.type };
        default: throw new EmailInputError('Unsupported automation step.');
    } });
    return { ...common(v), name: string(v.name, 150, false), trigger: choice(v.trigger, ['lead.created', 'service.updated', 'report.ready', 'manual', 'subscription.confirmed']), purpose: choice(v.purpose, emailPurposes), status: 'draft', steps };
}
export function parseEmailSettings(v: unknown): EmailSettings { if (!object(v) || typeof v.enabled !== 'boolean' || typeof v.clickTracking !== 'boolean' || typeof v.accent !== 'string' || !/^#[\da-f]{6}$/i.test(v.accent) || v.replyTo && !validEmail(v.replyTo))
    throw new EmailInputError('Check email settings and reply address.'); if(typeof v.senderName==='string'&&/[\r\n]/.test(v.senderName))throw new EmailInputError('Use a single line for the sender name.'); const timezone = string(v.timezone, 100, false); try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
}
catch {
    throw new EmailInputError('Choose a valid timezone.');
} return { enabled: v.enabled, mode: choice(v.mode, ['capture', 'send']), senderName: string(v.senderName, 150), logoUrl: v.logoUrl ? safeEmailUrl(v.logoUrl) : '', replyTo: string(v.replyTo ?? '', 254), postalAddress: string(v.postalAddress ?? '', 500), accent: v.accent, timezone, perMinute: integer(v.perMinute, 1, 100), dailyLimit: integer(v.dailyLimit, 1, 100000), monthlyLimit: integer(v.monthlyLimit, 1, 1000000), recipientCap: integer(v.recipientCap, 1, 10000), spacingHours: integer(v.spacingHours, 0, 720), otherAccountEmails: integer(v.otherAccountEmails, 0, 10000000), reservedDaily: integer(v.reservedDaily, 0, 100000), clickTracking: v.clickTracking }; }
export function emailOverage(count: number): number { return Math.round(Math.max(0, count - 3000) * 0.035) / 100; }
export function starterEmailTemplates(): EmailTemplate[] {
    return [
        { id: 'starter-report', revision: 0, name: 'Customer report', layout: 'report', subject: 'Your {{report.period|latest}} report', preheader: 'An update on your agreed service.', blocks: [{ type: 'heading', text: '{{report.title|Your service report}}' }, { type: 'paragraph', text: 'Hello {{firstName|there}},\n\n{{report.summary|Your requested report is ready.}}' }] },
        { id: 'starter-response', revision: 0, name: 'Personal response', layout: 'letter', subject: 'We received your enquiry', preheader: 'Your enquiry has reached our team.', blocks: [{ type: 'paragraph', text: 'Hello {{firstName|there}},\n\nThank you for contacting us. Our team has received your request and will respond with the information you asked for.' }] },
        { id: 'starter-update', revision: 0, name: 'Service update', layout: 'update', subject: 'An update on your service', preheader: 'The latest status of your agreed service.', blocks: [{ type: 'heading', text: 'Your service update' }, { type: 'paragraph', text: 'Hello {{firstName|there}},\n\n{{report.summary|We have an update about your agreed service.}}' }] },
        { id: 'starter-newsletter', revision: 0, name: 'Newsletter draft', layout: 'newsletter', subject: 'This month’s notes', preheader: 'Stories and updates.', blocks: [{ type: 'heading', text: 'This month’s notes' }, { type: 'paragraph', text: 'Write your opening note here.' }] }
    ];
}
