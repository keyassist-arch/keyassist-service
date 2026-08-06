import { ProductSource } from '../../common/enums/product-source.enum';

export type MarketplaceEstimate = {
  /** Estimated US sales tax rate (fraction) applied at checkout */
  taxRate: number;
  /** Estimated domestic US shipping cost to warehouse (USD) */
  domesticShippingUsd: number;
  /** How reliable these estimates are */
  confidence: 'high' | 'medium' | 'low';
};

/**
 * Per-marketplace tax + domestic shipping estimates to our US warehouse.
 *
 * TAX NOTES:
 * Despite early assumptions about a Delaware (no-sales-tax) warehouse, in practice
 * most major marketplaces collect sales tax as marketplace facilitators regardless
 * of destination state. Rates below reflect observed real-world averages.
 * They are ESTIMATES — the actual rate varies by product category and destination
 * state. When an adapter can read the real tax from a product page or checkout
 * simulation, pass taxAmountUsd to LandedCostQuoteDto to bypass this estimate.
 *
 * US weighted-average sales tax ≈ 8.6%. Marketplace-specific notes inline.
 */
export const MARKETPLACE_ESTIMATES: Record<ProductSource, MarketplaceEstimate> =
  {
    [ProductSource.AMAZON]: {
      // Marketplace facilitator — collects tax in all 45 tax states.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.APPLE]: {
      // Apple collects tax as a direct seller; rate varies by state and product.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.NIKE]: {
      // Nike.com collects tax in all US states; confirmed in practice.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.CONVERSE]: {
      // Converse.com (Nike subsidiary) — same tax behaviour.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.ZARA]: {
      // Zara US collects sales tax as a direct retailer.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.STOCKX]: {
      // StockX charges a buyer processing fee (built into displayed price); tax varies.
      taxRate: 0.088,
      domesticShippingUsd: 13.95,
      confidence: 'medium',
    },
    [ProductSource.GOAT]: {
      // GOAT charges buyer fees; tax collected on top in taxable states.
      taxRate: 0.088,
      domesticShippingUsd: 12.5,
      confidence: 'medium',
    },
    [ProductSource.EBAY]: {
      // eBay marketplace facilitator; observed ~7.5%.
      taxRate: 0.075,
      domesticShippingUsd: 9.99,
      confidence: 'medium',
    },
    [ProductSource.SHEIN]: {
      // Shein ships from China; no US sales tax collected.
      taxRate: 0.0,
      domesticShippingUsd: 3.99,
      confidence: 'medium',
    },
    [ProductSource.JUMIA]: {
      // Africa-based — no US warehouse leg.
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'low',
    },
    [ProductSource.ETSY]: {
      // Etsy marketplace facilitator; observed ~8%.
      taxRate: 0.08,
      domesticShippingUsd: 6.5,
      confidence: 'medium',
    },
    [ProductSource.BACK_MARKET]: {
      // Refurbished electronics — tax varies; free shipping typical.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.WALMART]: {
      // Walmart marketplace facilitator — collects tax in all tax states.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.REEBELO]: {
      // Refurbished goods; tax varies by state.
      taxRate: 0.088,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.GENERIC]: {
      taxRate: 0.088,
      domesticShippingUsd: 9.99,
      confidence: 'low',
    },
    [ProductSource.KEYASSIST]: {
      // Sourced/held by Key Assist directly — no separate US retail purchase leg.
      taxRate: 0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
  };
