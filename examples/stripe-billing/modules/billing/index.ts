import {createStripeBilling} from '../../../../packages/admin/src/billing/module.ts';
import configuration from '../../billing.config.json';
import type {StripeBillingConfig} from '../../../../packages/contracts/src/stripe-billing.ts';
export default createStripeBilling(configuration as StripeBillingConfig);
