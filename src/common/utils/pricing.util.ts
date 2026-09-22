/** @deprecated Use computePlatformFee() for the tiered structure */
export const SERVICE_CHARGE_RATE = 0.1;
export const PRODUCT_TAX_RATE = 0.0825;
export const DISCOUNT_RATE = 0.2;
export const DISCOUNT_THRESHOLD_USD = 1000;

/** Platform service fee: $6 flat for items ≤ $100, 10% for items > $100 */
export function computePlatformFee(priceUsd: number): number {
  return priceUsd <= 100 ? 6 : Math.round(priceUsd * 0.1 * 100) / 100;
}

export const FIRST_ORDER_DISCOUNT_RATE = 0.5;

export type PricingBreakdown = {
  serviceCharge: number;
  discount: number;
  fees: number;
  shippingFee: number;
  total: number;
};

export function computePricing(
  subtotal: number,
  shippingFee = 0,
  isFirstOrder = false,
): PricingBreakdown {
  const baseTotal = subtotal + shippingFee;
  const rawServiceCharge = Math.round(baseTotal * SERVICE_CHARGE_RATE * 100) / 100;
  const firstOrderDiscount = isFirstOrder
    ? Math.round(rawServiceCharge * FIRST_ORDER_DISCOUNT_RATE * 100) / 100
    : 0;
  const volumeDiscount =
    subtotal > DISCOUNT_THRESHOLD_USD ? Math.round(subtotal * DISCOUNT_RATE * 100) / 100 : 0;
  const discount = Math.round((firstOrderDiscount + volumeDiscount) * 100) / 100;
  const serviceCharge = rawServiceCharge;
  const fees = serviceCharge;
  const total = Math.round((subtotal + fees + shippingFee - discount) * 100) / 100;
  return { serviceCharge, discount, fees, shippingFee, total };
}
