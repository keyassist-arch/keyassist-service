import type { ProductConfigurationPrice } from '../../products/entities/product.entity';

export interface ScrapedProduct {
  title: string;
  price: string;
  currency: string;
  images: string[];
  description?: string;
  brand?: string;
  /** Marketplace-specific product identifier (e.g. Amazon ASIN). */
  asin?: string;
  /** Generic product / listing SKU (non-Amazon adapters; use `asin` for Amazon). */
  sku?: string;
  /** Aggregate customer rating. */
  rating?: { value: string | number; reviewCount?: number };
  /** Primary seller shown on the PDP. */
  seller?: { name: string; url?: string };
  /** Structured product attributes, e.g. { "Storage": "256GB", "Color": "Black" }. */
  specifications?: Record<string, string>;
  variants: { name: string; options: string[] }[];
  /**
   * Retailer “was” / list price when the PDP shows a markdown (e.g. Amazon strike price).
   * Stored in catalog description for transparency; `price` remains the current selling price.
   */
  compareAtPrice?: string;
  /** Savings percentage badge text, e.g. “-40%” or “60% off”. */
  discount?: string;
  /** Absolute savings amount as a decimal string, e.g. “1020.00”. */
  savingsAmount?: string;
  /** Promotional label, e.g. “Limited-time deal” or “Lightning Deal”. */
  dealType?: string;
  /** Adapter-specific extra data (e.g. Apple carrier→URL routing map). */
  metadata?: Record<string, unknown>;
  availability?: string;
  /**
   * Actual sales tax in USD as shown on the product page or checkout summary.
   * When populated by an adapter, the landed-cost quote uses this directly
   * instead of the per-marketplace flat-rate estimate.
   */
  taxAmountUsd?: number;
  /**
   * Full configuration lines from matrix-style PDPs (e.g. Apple: storage + color + carrier + price).
   * Folded into `description` for persistence when adapters set it.
   */
  configurationSummaries?: string[];
  /**
   * Structured per-option **supplier** prices (decimal strings).
   * When `variantAxis` + `optionValue` are set, align rows with `variants` for store-style selectors (GOAT sizes, Zara colors, etc.).
   * API adds `salePrice` per row from `markupPercent`.
   */
  configurationPrices?: ProductConfigurationPrice[];
}
