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
 * These are averages; headless checkout simulation would replace them with
 * real numbers when that layer is built.
 *
 * Tax rates based on Delaware warehouse (no sales tax state).
 * Domestic shipping: cost from marketplace fulfillment center → our warehouse.
 */
export const MARKETPLACE_ESTIMATES: Record<ProductSource, MarketplaceEstimate> =
  {
    [ProductSource.AMAZON]: {
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.APPLE]: {
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.NIKE]: {
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.CONVERSE]: {
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.ZARA]: {
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.STOCKX]: {
      // StockX charges a seller fee (built into ask price) and buyer processing fee
      taxRate: 0.0,
      domesticShippingUsd: 13.95,
      confidence: 'high',
    },
    [ProductSource.GOAT]: {
      taxRate: 0.0,
      domesticShippingUsd: 12.5,
      confidence: 'high',
    },
    [ProductSource.EBAY]: {
      taxRate: 0.075,
      domesticShippingUsd: 9.99,
      confidence: 'medium',
    },
    [ProductSource.SHEIN]: {
      // Shein ships from China; no US tax collected
      taxRate: 0.0,
      domesticShippingUsd: 3.99,
      confidence: 'medium',
    },
    [ProductSource.JUMIA]: {
      // Africa-based — no US warehouse leg; domestic shipping N/A
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'low',
    },
    [ProductSource.ETSY]: {
      // Etsy collects US sales tax on behalf of sellers in most states
      taxRate: 0.08,
      domesticShippingUsd: 6.5,
      confidence: 'medium',
    },
    [ProductSource.BACK_MARKET]: {
      // Back Market ships refurbished electronics from US sellers; free shipping common
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.WALMART]: {
      // Walmart.com ships from US fulfillment centers; free shipping on most orders
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.REEBELO]: {
      // Reebelo ships refurbished goods from US-based vendors; free shipping typical
      taxRate: 0.0,
      domesticShippingUsd: 0,
      confidence: 'high',
    },
    [ProductSource.GENERIC]: {
      taxRate: 0.08,
      domesticShippingUsd: 9.99,
      confidence: 'low',
    },
  };
