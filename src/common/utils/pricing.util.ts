/** @deprecated Use computePlatformFee() for the tiered structure */
export const SERVICE_CHARGE_RATE = 0.1;
export const PRODUCT_TAX_RATE = 0.0825;

/** Platform service fee: $6 flat for items ≤ $100, 10% for items > $100 */
export function computePlatformFee(priceUsd: number): number {
  return priceUsd <= 100 ? 6 : Math.round(priceUsd * 0.1 * 100) / 100;
}

/** Admin-configurable discount rates (see `discount_settings`). */
export type DiscountRates = {
  /** Fraction (0–1) of the platform fee taken off a first order. */
  firstOrderDiscountRate: number;
  /** Fraction (0–1) of the product subtotal taken off above the threshold. */
  volumeDiscountRate: number;
  volumeDiscountThresholdUsd: number;
};

/** No discount unless an admin configures one. */
export const DEFAULT_DISCOUNT_RATES: DiscountRates = {
  firstOrderDiscountRate: 0,
  volumeDiscountRate: 0,
  volumeDiscountThresholdUsd: 1000,
};

/** First-order discount (on the platform fee) + volume discount (on the product subtotal). */
export function computeDiscount(
  serviceCharge: number,
  productSubtotal: number,
  isFirstOrder: boolean,
  rates: DiscountRates = DEFAULT_DISCOUNT_RATES,
): number {
  const firstOrderDiscount = isFirstOrder
    ? Math.round(serviceCharge * rates.firstOrderDiscountRate * 100) / 100
    : 0;
  const volumeDiscount =
    rates.volumeDiscountRate > 0 && productSubtotal > rates.volumeDiscountThresholdUsd
      ? Math.round(productSubtotal * rates.volumeDiscountRate * 100) / 100
      : 0;
  return Math.round((firstOrderDiscount + volumeDiscount) * 100) / 100;
}

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
  discountRates: DiscountRates = DEFAULT_DISCOUNT_RATES,
): PricingBreakdown {
  const baseTotal = subtotal + shippingFee;
  const rawServiceCharge = Math.round(baseTotal * SERVICE_CHARGE_RATE * 100) / 100;
  const discount = computeDiscount(rawServiceCharge, subtotal, isFirstOrder, discountRates);
  const serviceCharge = rawServiceCharge;
  const fees = serviceCharge;
  const total = Math.round((subtotal + fees + shippingFee - discount) * 100) / 100;
  return { serviceCharge, discount, fees, shippingFee, total };
}
