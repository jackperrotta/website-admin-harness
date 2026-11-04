/** Local preview contracts. These are not a production Stripe integration. */
export const billingPermissions = ['billing:read', 'billing:customers:write', 'billing:catalog:read', 'billing:subscriptions:write', 'billing:invoices:write', 'billing:collect', 'billing:connection:manage', 'account-billing:read', 'account-billing:manage'] as const;
export interface BillingCustomer {id: string; name: string; contact: string; email: string; initials: string; color: string; websites: string[]; note: string}
export interface BillingPlan {id: string; name: string; description: string; amount: number; interval: 'month' | 'year'; features: string[]; selfService: boolean}
export interface BillingSubscription {id: string; customerId: string; planId: string; status: 'active' | 'past_due' | 'trialing' | 'canceled'; renewal: string; cancelAtPeriodEnd: boolean; scheduledPlanId: string | null}
export interface BillingLine {description: string; quantity: number; unitAmount: number}
export interface BillingInvoice {id: string; customerId: string; number: string; description: string; lines: BillingLine[]; status: 'draft' | 'open' | 'paid' | 'void'; issued: string; due: string; paidAt: string | null; kind: 'subscription' | 'one_off'}
export interface BillingPayment {id: string; customerId: string; invoiceId: string; amount: number; status: 'succeeded' | 'failed' | 'refunded'; date: string}
export interface BillingActivity {id: string; customerId: string | null; text: string; at: string}
export interface BillingState {customers: BillingCustomer[]; plans: BillingPlan[]; subscriptions: BillingSubscription[]; invoices: BillingInvoice[]; payments: BillingPayment[]; activity: BillingActivity[]; connection: boolean; card: {brand: string; last4: string; expiry: string}}
export interface BillingResponse extends BillingState {revision: number; simulated: true; audience: 'seller' | 'customer'; customerId: string | null; supplier: string; asOf: string; currency: 'USD'}
export type BillingCommand =
  | {action: 'plan'; subscriptionId: string; planId: string; timing: 'renewal' | 'now'; reviewed: boolean}
  | {action: 'cancel' | 'resume'; subscriptionId: string; reviewed: boolean}
  | {action: 'draft'; invoiceId?: string; customerId: string; description: string; due: string; lines: BillingLine[]}
  | {action: 'send' | 'void' | 'pay'; invoiceId: string; reviewed: boolean}
  | {action: 'card'; reviewed: boolean}
  | {action: 'connection'; connected: boolean};
export type BillingMutation = BillingCommand & {revision: number; idempotencyKey: string};
export const invoiceTotal = (invoice: Pick<BillingInvoice, 'lines'>) => invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
