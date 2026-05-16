import type { ProductCategory } from './category-weights';

export type CustomsRate = {
  /**
   * Combined effective rate applied to product subtotal only.
   * Covers duty + effective VAT + clearing agent — consolidated so the
   * calculation doesn't compound on top of an already-inflated CIF value.
   * Rates reflect freight-forwarder batch-clearance economics, not textbook
   * single-shipment courier rates.
   */
  combinedRate: number;
};

export const NIGERIA_CUSTOMS_RATES: Record<ProductCategory, CustomsRate> = {
  sneakers:          { combinedRate: 0.15 },
  clothing:          { combinedRate: 0.12 },
  phone:             { combinedRate: 0.08 },
  laptop:            { combinedRate: 0.08 },
  tablet:            { combinedRate: 0.08 },
  tv:                { combinedRate: 0.20 },
  electronics_small: { combinedRate: 0.08 },
  electronics_large: { combinedRate: 0.12 },
  accessories:       { combinedRate: 0.12 },
  books:             { combinedRate: 0.00 },
  generic:           { combinedRate: 0.15 },
};
