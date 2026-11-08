import type { EmailContact, EmailSettings, EmailTemplate } from '../../../contracts/src/email-campaigns.ts';
import { escapeHtml, fail } from './shared.ts';
export interface EmailReport {
    title: string;
    period: string;
    summary: string;
    url?: string;
}
export function renderEmail(template: EmailTemplate, contact: Pick<EmailContact, 'name' | 'company'>, settings: EmailSettings, business: string, preferenceUrl: string, report?: EmailReport) {
    const values: Record<string, string> = { name: contact.name, firstName: contact.name.split(/\s+/)[0], company: contact.company, business, 'report.title': report?.title || '', 'report.period': report?.period || '', 'report.summary': report?.summary || '' };
    const fill = (s: string) => s.replace(/\{\{([^{}]+)\}\}/g, (_, part: string) => { const [key, ...fallback] = part.split('|'); if (!(key.trim() in values))
        return fail(400, 'template_variable', `Unsupported personalization field: ${key.trim()}`); const value = values[key.trim()] || fallback.join('|'); if (!value)
        return fail(400, 'template_value', 'Add a fallback for missing personalization values.'); return value; });
    const subject = fill(template.subject).replace(/[\r\n]/g, ' ').slice(0, 250), preheader = fill(template.preheader), text: string[] = [];
    const blocks = template.blocks.map(block => { const s = fill(block.text), value = escapeHtml(s); text.push(block.type === 'divider' ? '—' : block.type === 'image' ? `[${block.alt || ''}]` : (block.url ? `${s}: ${block.url}` : s)); switch (block.type) {
        case 'heading': return `<h2 style="font-size:25px;line-height:1.3;margin:28px 0 14px">${value}</h2>`;
        case 'paragraph': return `<p style="font-size:16px;line-height:1.7;margin:16px 0">${value.replaceAll('\n', '<br>')}</p>`;
        case 'button': return `<p style="margin:26px 0"><a href="${escapeHtml(block.url!)}" style="background:${settings.accent};color:#fff;padding:13px 22px;border-radius:5px;display:inline-block;text-decoration:none">${value}</a></p>`;
        case 'image': return `<img src="${escapeHtml(block.url!)}" alt="${escapeHtml(block.alt!)}" width="560" style="width:100%;max-width:560px;height:auto;border:0">`;
        case 'divider': return '<hr style="border:0;border-top:1px solid #d8dedc;margin:28px 0">';
    } }).join('');
    const footer = `${business}${settings.postalAddress ? ' · ' + settings.postalAddress : ''}`;
    return { subject, text: [...text, footer, 'Email preferences: ' + preferenceUrl].join('\n\n'), html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f2f4f3;color:#182c25;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" style="width:100%;max-width:600px;background:#fff" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 24px;border-top:4px solid ${settings.accent}"><p style="font-size:13px;letter-spacing:1px;font-weight:bold">${settings.logoUrl ? '<img src="' + escapeHtml(settings.logoUrl) + '" alt="' + escapeHtml(business) + '" width="140" style="max-width:140px;height:auto;display:block;margin-bottom:18px">' : ''}${escapeHtml(settings.senderName || business)}</p>${blocks}<hr style="border:0;border-top:1px solid #d8dedc;margin-top:32px"><p style="font-size:12px;line-height:1.6;color:#596760">${escapeHtml(footer)}<br><a style="color:inherit" href="${escapeHtml(preferenceUrl)}">Email preferences and unsubscribe</a></p></td></tr></table></td></tr></table></body></html>` };
}
