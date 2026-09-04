export const SERVICE_CHARGE_RATE = 0.1;
export const PRODUCT_TAX_RATE = 0.0825;
export const DISCOUNT_RATE = 0.2;
export const DISCOUNT_THRESHOLD_USD = 1000;

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
): PricingBreakdown {
  const serviceCharge = subtotal * SERVICE_CHARGE_RATE;
  const discount =
    subtotal > DISCOUNT_THRESHOLD_USD ? subtotal * DISCOUNT_RATE : 0;
  const fees = serviceCharge;
  const total = subtotal + fees + shippingFee - discount;
  return { serviceCharge, discount, fees, shippingFee, total };
}
