export interface BookingEnv {
 SCHEDULING_NOTIFICATIONS_ENABLED?: string; SCHEDULING_TOKEN_KEYS?: string;
 SCHEDULING_EMAIL_FROM?: string; SCHEDULING_EMAIL_REPLY_TO?: string; SCHEDULING_TEST_RECIPIENTS?: string;
 BOOKING_MANAGE_PATH?: string;
 SCHEDULING_EMAIL?: {send(message: SchedulingEmailMessage): Promise<{messageId: string}>};
 BOOKING_ENABLED?: string; BOOKING_LOCAL_TEST?: string; BOOKING_RATE_SECRET?: string;
 BOOKING_TURNSTILE_SITE_KEY?: string; BOOKING_TURNSTILE_SECRET?: string;
 /** Trusted server-side acceptance transport, never browser configured. */
 BOOKING_CHALLENGE_HTTP?: Pick<Fetcher,'fetch'>;
}

export interface SchedulingEmailMessage {
 to: string; from: string; subject: string; text: string; html: string; replyTo?: string;
 headers: Record<string,string>;
 attachments: {filename:string;type:string;disposition:'attachment';content:string}[];
}
