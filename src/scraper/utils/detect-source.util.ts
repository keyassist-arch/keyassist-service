import { ProductSource } from '../../common/enums/product-source.enum';

export function detectProductSource(url: string): ProductSource {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    h = url.toLowerCase();
  }
  if (h.includes('jumia.')) return ProductSource.JUMIA;
  if (h.includes('amazon.') || h.includes('amzn.')) return ProductSource.AMAZON;
  if (h.includes('nike.')) return ProductSource.NIKE;
  if (h.includes('apple.')) return ProductSource.APPLE;
  if (h.includes('shein.')) return ProductSource.SHEIN;
  if (h.includes('goat.com')) return ProductSource.GOAT;
  if (h.includes('stockx.com')) return ProductSource.STOCKX;
  if (h.includes('ebay.')) return ProductSource.EBAY;
  if (h.includes('zara.com')) return ProductSource.ZARA;
  if (h.includes('converse.com')) return ProductSource.CONVERSE;
  if (h.includes('etsy.com')) return ProductSource.ETSY;
  if (h.includes('backmarket.com') || h.includes('backmarket.co')) return ProductSource.BACK_MARKET;
  return ProductSource.GENERIC;
}
