/** Browser-safe signup transport. Obtain the Turnstile token from the website's real widget. */
export async function subscribeToCustomerEmails(connection: {
    adminOrigin: string;
    local?: boolean;
}, input: {
    email: string;
    name?: string;
    topic: 'reports' | 'service' | 'newsletter';
    turnstileToken: string;
}) { const url = new URL(connection.adminOrigin); if (url.origin !== connection.adminOrigin || url.protocol !== 'https:' && !(connection.local && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    throw Error('Use the configured exact admin origin.'); const response = await fetch(url.origin + '/api/modules/email-campaigns/public/signup', { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); const result = await response.json() as {
    ok?: boolean;
    error?: string;
    message?: string;
}; if (!response.ok || result.ok !== true)
    throw Error(result.error || 'Email signup could not complete.'); return result.message || 'If eligible, a confirmation email will follow.'; }
