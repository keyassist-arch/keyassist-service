import { ProductSource } from '../../common/enums/product-source.enum';

export function detectProductSource(url: string): ProductSource {
  const u = url.toLowerCase();
  if (u.includes('jumia.')) return ProductSource.JUMIA;
  if (u.includes('amazon.') || u.includes('amzn.')) return ProductSource.AMAZON;
  if (u.includes('nike.')) return ProductSource.NIKE;
  if (u.includes('apple.')) return ProductSource.APPLE;
  if (u.includes('shein.')) return ProductSource.SHEIN;
  return ProductSource.GENERIC;
}
