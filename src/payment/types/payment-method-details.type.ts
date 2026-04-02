/**
 * Normalized snapshot stored on the order after successful payment.
 */
export type PaymentMethodDetails = {
  provider: string;
  /** e.g. card, bank, ussd, link, us_bank_account */
  type?: string;
  /** Human-readable label for receipts */
  label?: string;
  brand?: string;
  last4?: string;
  bank?: string;
  channel?: string;
  [key: string]: unknown;
};
