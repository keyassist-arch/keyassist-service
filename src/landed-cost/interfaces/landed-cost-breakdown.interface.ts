import type { ProductSource } from '../../common/enums/product-source.enum';
import type { ProductCategory } from '../rules/category-weights';

export interface LandedCostBreakdown {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  marketplace: ProductSource;
  category: ProductCategory;
  quantity: number;
  estimatedWeightLbs: number;
  marketplaceConfidence: 'high' | 'medium' | 'low';

  // ── Item cost / COGS (USD) ──────────────────────────────────────────────────
  productSubtotalUsd: number;
  /** US sales tax on the goods. Billed inside `itemCostUsd`, never as its own line. */
  marketplaceTaxUsd: number;
  /**
   * Sales-tax rate behind `marketplaceTaxUsd` (fraction, e.g. 0.0825).
   * 0 when a real observed tax amount was supplied instead of the rate estimate.
   */
  taxRate: number;
  /** Invoice line 1 — `productSubtotalUsd` + `marketplaceTaxUsd`. */
  itemCostUsd: number;

  // ── Logistics costs (USD) ───────────────────────────────────────────────────
  /** US domestic shipping to the warehouse. Billed inside `importAndDeliveryUsd`. */
  marketplaceShippingUsd: number;
  /** Box / warehouse handling. Billed inside `importAndDeliveryUsd`. */
  domesticHandlingUsd: number;
  /** Kingz all-inclusive rate (customs & clearing included in their price) */
  internationalShippingUsd: number;
  /**
   * Invoice line 2 — `marketplaceShippingUsd` + `domesticHandlingUsd` +
   * `internationalShippingUsd`. The box fee lives here, not on its own line.
   */
  importAndDeliveryUsd: number;
  /** Invoice line 4 — optional cargo insurance (3% of item cost, Lagos only). 0 unless opted in. */
  insuranceUsd: number;

  // ── Buffers (USD) ───────────────────────────────────────────────────────────
  fxBufferUsd: number;
  riskBufferUsd: number;

  // ── Our margin (USD) ────────────────────────────────────────────────────────
  /** Invoice line 3 — platform service fee. */
  serviceChargeUsd: number;
  discountUsd: number;

  // ── Totals ──────────────────────────────────────────────────────────────────
  totalUsd: number;
  displayCurrency: string;
  /** Total in the requested display currency */
  totalDisplay: number;

  /** Human-readable line items for UI display */
  breakdown: string[];
}
