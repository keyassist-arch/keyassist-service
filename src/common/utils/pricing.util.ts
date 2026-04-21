export const SERVICE_CHARGE_RATE = 0.2;
export const DISCOUNT_RATE = 0.2;
export const DISCOUNT_THRESHOLD = 1000;

export type PricingBreakdown = {
  serviceCharge: number;
  discount: number;
  fees: number;
  total: number;
};

export function computePricing(subtotal: number): PricingBreakdown {
  const serviceCharge = subtotal * SERVICE_CHARGE_RATE;
  const discount = subtotal > DISCOUNT_THRESHOLD ? subtotal * DISCOUNT_RATE : 0;
  const fees = serviceCharge - discount;
  const total = subtotal + fees;
  return { serviceCharge, discount, fees, total };
}

