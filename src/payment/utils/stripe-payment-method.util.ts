import type Stripe from 'stripe';
import type { PaymentMethodDetails } from '../types/payment-method-details.type';

export function stripePaymentMethodToDetails(
  pm: Stripe.PaymentMethod | null | undefined,
): PaymentMethodDetails | null {
  if (!pm) {
    return null;
  }
  const base: PaymentMethodDetails = {
    provider: 'stripe',
    type: pm.type,
  };
  if (pm.type === 'card' && pm.card) {
    base.brand = pm.card.brand ?? undefined;
    base.last4 = pm.card.last4 ?? undefined;
    base.label = [pm.card.brand, pm.card.last4 ? `···${pm.card.last4}` : '']
      .filter(Boolean)
      .join(' ');
    return base;
  }
  if (pm.type === 'link') {
    base.label = 'Link';
    return base;
  }
  if (pm.type === 'us_bank_account' && pm.us_bank_account) {
    base.bank = pm.us_bank_account.bank_name ?? undefined;
    base.last4 = pm.us_bank_account.last4 ?? undefined;
    base.label = `${pm.us_bank_account.bank_name ?? 'Bank'} ····${pm.us_bank_account.last4 ?? ''}`;
    return base;
  }
  if (pm.type === 'ideal' && pm.ideal) {
    base.bank = pm.ideal.bank ?? undefined;
    base.label = pm.ideal.bank ?? 'iDEAL';
    return base;
  }
  if (pm.type === 'sepa_debit' && pm.sepa_debit) {
    base.last4 = pm.sepa_debit.last4 ?? undefined;
    base.label = `SEPA ····${pm.sepa_debit.last4 ?? ''}`;
    return base;
  }
  base.label = pm.type;
  return base;
}
