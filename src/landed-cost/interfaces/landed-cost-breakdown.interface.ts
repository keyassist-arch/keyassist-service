import type { ProductSource } from '../../common/enums/product-source.enum';
import type { ProductCategory } from '../rules/category-weights';

export interface LandedCostBreakdown {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  marketplace: ProductSource;
  category: ProductCategory;
  quantity: number;
  estimatedWeightLbs: number;
  marketplaceConfidence: 'high' | 'medium' | 'low';

  // ── Source marketplace costs (USD) ──────────────────────────────────────────
  productSubtotalUsd: number;
  marketplaceTaxUsd: number;
  marketplaceShippingUsd: number;

  // ── Logistics costs (USD) ───────────────────────────────────────────────────
  domesticHandlingUsd: number;
  boxHandlingFeeUsd?: number;
  cargoInsuranceUsd?: number;
  internationalShippingUsd: number;
  importAndDeliveryUsd: number;

  // ── Customs (USD) ───────────────────────────────────────────────────────────
  customsDutyUsd: number;
  customsVatUsd: number;
  customsClearingFeeUsd: number;

  // ── Buffers (USD) ────────────────────────────────────────────────────────────
  fxBufferUsd: number;
  riskBufferUsd: number;

  // ── Our margin (USD) ────────────────────────────────────────────────────────
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
