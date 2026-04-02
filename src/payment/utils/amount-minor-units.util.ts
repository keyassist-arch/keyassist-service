/** Currencies Stripe treats as zero-decimal for Checkout / PaymentIntents */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function amountToMinorUnits(amount: string, currency: string): number {
  const c = currency.toUpperCase();
  const n = parseFloat(amount);
  if (Number.isNaN(n)) {
    return 0;
  }
  if (ZERO_DECIMAL.has(c)) {
    return Math.round(n);
  }
  return Math.round(n * 100);
}
