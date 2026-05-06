export const SERVICE_CHARGE_RATE = 0.2;

export type PricingBreakdown = {
  serviceCharge: number;
  discount: number;
  fees: number;
  total: number;
};

export function computePricing(subtotal: number): PricingBreakdown {
  // Store-direct pricing: checkout totals should mirror scraped store prices.
  const serviceCharge = 0;
  const discount = 0;
  const fees = 0;
  const total = subtotal + fees;
  return { serviceCharge, discount, fees, total };
}

