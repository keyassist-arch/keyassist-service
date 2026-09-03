import { ProductSource } from '../../common/enums/product-source.enum';

export type MarketplaceEstimate = {
  /** Estimated US sales tax rate (fraction) applied at checkout */
  taxRate: number;
  /** Estimated domestic US shipping cost to warehouse (USD) */
  domesticShippingUsd: number;
  /** How reliable these estimates are */
  confidence: 'high' | 'medium' | 'low';
};

/** Agreed flat US sales-tax rate applied to the item cost of US-sourced goods. */
export const US_SALES_TAX_RATE = 0.0825;

/**
 * Per-marketplace tax + domestic shipping estimates to our US warehouse.
 *
 * TAX NOTES:
 * Despite early assumptions about a Delaware (no-sales-tax) warehouse, in practice
 * most major marketplaces collect sales tax as marketplace facilitators regardless
 * of destination state. Every US retailer therefore quotes at the agreed flat
 * `US_SALES_TAX_RATE` (8.25%); sellers with no US retail leg (Shein ex-China, Jumia,
 * Key Assist's own stock) stay at 0. The rate is an ESTIMATE — the real figure varies
 * by product category and destination state, so when an adapter reads the actual tax
 * off a product page or checkout simulation, pass `taxAmountUsd` to
 * LandedCostQuoteDto and it overrides this entirely.
 *
 * Tax is billed as part of item cost (COGS), not as a logistics line.
 */
export const MARKETPLACE_ESTIMATES: Record<ProductSource, MarketplaceEstimate> =
  {
    [ProductSource.AMAZON]: {
      // Marketplace facilitator — collects tax in all 45 tax states.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.APPLE]: {
      // Apple collects tax as a direct seller; rate varies by state and product.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.NIKE]: {
      // Nike.com collects tax in all US states; confirmed in practice.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.CONVERSE]: {
      // Converse.com (Nike subsidiary) — same tax behaviour.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.ZARA]: {
      // Zara US collects sales tax as a direct retailer.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.STOCKX]: {
      // StockX charges a buyer processing fee (built into displayed price); tax varies.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 13.95,
      confidence: 'medium',
    },
    [ProductSource.GOAT]: {
      // GOAT charges buyer fees; tax collected on top in taxable states.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 12.5,
      confidence: 'medium',
    },
    [ProductSource.EBAY]: {
      // eBay marketplace facilitator — collects tax in all tax states.
      taxRate: US_SALES_TAX_RATE,
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
      // Etsy marketplace facilitator — collects tax in all tax states.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 6.5,
      confidence: 'medium',
    },
    [ProductSource.BACK_MARKET]: {
      // Refurbished electronics — tax varies; free shipping typical.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.WALMART]: {
      // Walmart marketplace facilitator — collects tax in all tax states.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.REEBELO]: {
      // Refurbished goods; tax varies by state.
      taxRate: US_SALES_TAX_RATE,
      domesticShippingUsd: 0,
      confidence: 'medium',
    },
    [ProductSource.GENERIC]: {
      taxRate: US_SALES_TAX_RATE,
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
