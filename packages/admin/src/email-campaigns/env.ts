import type { AdminEnv } from '../worker.ts';
export interface CampaignMessage {
    to: string;
    from: string | {email:string;name?:string};
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
    headers?: Record<string, string>;
}
export interface CampaignEnv extends AdminEnv {
    CAMPAIGN_EMAIL?: {
        send(message: CampaignMessage): Promise<{
            messageId: string;
        }>;
    };
    CAMPAIGN_FROM?: string;
    CAMPAIGN_SEND_ENABLED?: string;
    CAMPAIGN_EMAIL_READY?: string;
    CAMPAIGN_FEEDBACK_READY?: string;
    CAMPAIGN_TOKEN_KEYS?: string;
    CAMPAIGN_ID_KEY?: string;
    CAMPAIGN_WEBSITE_KEY?: string;
    CAMPAIGN_TURNSTILE_SECRET?: string;
    CAMPAIGN_CHALLENGE_HTTP?: Pick<Fetcher, 'fetch'>;
    CAMPAIGN_TEST_RECIPIENTS?: string;
}
