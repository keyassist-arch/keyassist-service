const SYMBOL_TO_ISO: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₦': 'NGN',
  '₹': 'INR',
  '¥': 'JPY',
};

/**
 * Returns the ISO 4217 currency code detected from the first currency symbol
 * found in `text`, or null if no recognised symbol is present.
 *
 * Used to let the displayed price string override structured-data currency
 * (JSON-LD priceCurrency, meta tags) which regional storefronts often leave
 * set to "USD" even when rendering local-currency prices.
 */
export function currencyFromPriceString(text: string): string | null {
  if (!text) return null;
  const m = text.match(/[£€$₦₹¥]/);
  return m ? (SYMBOL_TO_ISO[m[0]] ?? null) : null;
}
