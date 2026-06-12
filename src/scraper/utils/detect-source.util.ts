import { ProductSource } from '../../common/enums/product-source.enum';

/**
 * Returns true if `label` is an exact dot-delimited segment of `hostname`.
 * Handles multi-TLD brands: matchesLabel('www.amazon.co.uk', 'amazon') → true
 * Rejects substring matches: matchesLabel('badamazon.com', 'amazon') → false
 */
function matchesLabel(hostname: string, label: string): boolean {
  return hostname.split('.').includes(label);
}

/**
 * Returns true if `hostname` is exactly `domain` or a subdomain of it.
 * Use for single-TLD brands where the full domain is known and stable.
 * matchesDomain('www.goat.com', 'goat.com') → true
 * matchesDomain('goat.animalfarm.com', 'goat.com') → false
 */
function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectProductSource(url: string): ProductSource {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    h = url.toLowerCase();
  }

  // Multi-TLD brands — match by label so all country stores are covered.
  if (matchesLabel(h, 'jumia')) return ProductSource.JUMIA;
  if (matchesLabel(h, 'amazon') || matchesDomain(h, 'amzn.to')) return ProductSource.AMAZON;
  if (matchesLabel(h, 'nike')) return ProductSource.NIKE;
  if (matchesLabel(h, 'apple')) return ProductSource.APPLE;
  if (matchesLabel(h, 'shein')) return ProductSource.SHEIN;
  if (matchesLabel(h, 'ebay')) return ProductSource.EBAY;
  if (matchesLabel(h, 'backmarket')) return ProductSource.BACK_MARKET;

  // Single-TLD brands — match full domain for precision.
  if (matchesDomain(h, 'goat.com')) return ProductSource.GOAT;
  if (matchesDomain(h, 'stockx.com')) return ProductSource.STOCKX;
  if (matchesDomain(h, 'zara.com')) return ProductSource.ZARA;
  if (matchesDomain(h, 'converse.com')) return ProductSource.CONVERSE;
  if (matchesDomain(h, 'etsy.com')) return ProductSource.ETSY;
  if (matchesDomain(h, 'walmart.com')) return ProductSource.WALMART;
  if (matchesDomain(h, 'reebelo.com')) return ProductSource.REEBELO;

  return ProductSource.GENERIC;
}
