import type { PaymentMethodDetails } from '../types/payment-method-details.type';

/** Paystack charge.success `data` object (partial). */
export function paystackChargeToMethodDetails(data: {
  channel?: string;
  authorization?: {
    brand?: string;
    card_type?: string;
    last4?: string;
    bank?: string;
    channel?: string;
  };
}): PaymentMethodDetails {
  const auth = data.authorization;
  const brand = auth?.brand || auth?.card_type;
  const last4 = auth?.last4;
  return {
    provider: 'paystack',
    type: data.channel || auth?.channel || 'unknown',
    channel: data.channel,
    brand,
    last4,
    bank: auth?.bank,
    label: [brand, last4 ? `···${last4}` : data.channel]
      .filter(Boolean)
      .join(' '),
  };
}
