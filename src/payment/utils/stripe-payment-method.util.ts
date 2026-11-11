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
  // Stablecoins. `crypto` postdates the stripe@17 type union, so compare as string.
  if ((pm.type as string) === 'crypto') {
    base.label = 'Stablecoin';
    return base;
  }
  base.label = pm.type;
  return base;
}

type StripeCryptoChargeDetails = {
  buyer_address?: string | null;
  network?: string | null;
  token_currency?: string | null;
  transaction_hash?: string | null;
};

/**
 * Pulls on-chain details (wallet, network, token, tx hash) off a stablecoin charge's
 * `payment_method_details.crypto`. Returns {} when absent.
 */
export function stripeCryptoChargeDetails(
  charge: Stripe.Charge | null | undefined,
): Partial<PaymentMethodDetails> {
  const crypto = (
    charge?.payment_method_details as
      | { crypto?: StripeCryptoChargeDetails }
      | null
      | undefined
  )?.crypto;
  if (!crypto) {
    return {};
  }
  const token = crypto.token_currency?.toUpperCase();
  const network = crypto.network ?? undefined;
  return {
    channel: network,
    token: token ?? undefined,
    walletAddress: crypto.buyer_address ?? undefined,
    transactionHash: crypto.transaction_hash ?? undefined,
    label: [token ?? 'Stablecoin', network ? `on ${network}` : '']
      .filter(Boolean)
      .join(' '),
  };
}
