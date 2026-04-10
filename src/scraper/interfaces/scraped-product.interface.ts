import type { ProductConfigurationPrice } from '../../products/entities/product.entity';

export interface ScrapedProduct {
  title: string;
  price: number | string;
  currency: string;
  images: string[];
  description?: string;
  brand?: string;
  variants: { name: string; options: string[] }[];
  /**
   * Retailer “was” / list price when the PDP shows a markdown (e.g. Amazon strike price).
   * Stored in catalog description for transparency; `price` remains the current selling price.
   */
  compareAtPrice?: string;
  availability?: string;
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
