import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductSource } from '../common/enums/product-source.enum';

/**
 * Maps ProductSource to a category slug.  Overrides title/brand keyword matching for
 * marketplace adapters whose product type is always deterministic (Nike → sneakers, etc.).
 */
const SOURCE_SLUG: Partial<Record<ProductSource, string>> = {
  [ProductSource.APPLE]: 'electronics',
  [ProductSource.NIKE]: 'sneakers',
  [ProductSource.STOCKX]: 'sneakers',
  [ProductSource.GOAT]: 'sneakers',
  [ProductSource.CONVERSE]: 'sneakers',
  [ProductSource.ZARA]: 'fashion-apparel',
  [ProductSource.SHEIN]: 'fashion-apparel',
};

const ELECTRONICS_RE =
  /\b(phone|laptop|macbook|ipad|iphone|samsung|airpod|headphone|earphone|speaker|computer|monitor|camera|console|gaming|xbox|playstation|ps[0-9]|nintendo|android|pixel|galaxy|smartwatch|tablet|tv|television|drone|router|charger|cable|ssd|gpu|cpu|ram|keyboard|mouse)\b/i;

const SNEAKERS_RE =
  /\b(sneaker|shoe|boot|sandal|trainer|jordan|adidas|yeezy|dunk|air max|chuck|vans|puma|reebok|air force|footwear|cleat|loafer|mule|stiletto|heel|flat|slip.?on)\b/i;

const FASHION_RE =
  /\b(shirt|t-shirt|dress|jeans|denim|jacket|coat|trouser|pant|hoodie|sweater|blouse|skirt|fashion|apparel|clothing|wear|outfit|hat|cap|beanie|handbag|bag|wallet|scarf|glove|swimwear|bikini|lingerie|pyjama)\b/i;

const SPORTS_RE =
  /\b(sport|gym|fitness|running|yoga|cycling|swim|football|soccer|basketball|tennis|golf|hiking|climbing|ski|snowboard|martial art|boxing|wrestling|athletic)\b/i;

/** Classify a product to a category slug from source + title/brand text. */
export function classifySlug(
  source: ProductSource,
  brand: string | null,
  title: string,
): string {
  if (SOURCE_SLUG[source]) return SOURCE_SLUG[source]!;

  const text = `${brand ?? ''} ${title}`;

  if (ELECTRONICS_RE.test(text)) return 'electronics';
  if (SNEAKERS_RE.test(text)) return 'sneakers';
  if (FASHION_RE.test(text)) return 'fashion-apparel';
  if (SPORTS_RE.test(text)) return 'sports-outdoors';

  return 'general';
}

@Injectable()
export class CategoryClassifierService {
  private readonly logger = new Logger(CategoryClassifierService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * Classify and persist the category for a newly imported product.
   * No-ops if the product already has a `categoryId` (admin override is respected).
   */
  async assignCategoryToProduct(product: Product): Promise<void> {
    if (product.categoryId) return;

    const slug = classifySlug(product.source, product.brand, product.title);
    const cat = await this.categories.findOne({ where: { slug } });

    if (!cat) {
      this.logger.warn(
        `[classifier] no category row for slug="${slug}" — run seed-categories first (productId=${product.id})`,
      );
      return;
    }

    await this.products.update({ id: product.id }, { categoryId: cat.id });
    this.logger.log(
      `[classifier] productId=${product.id} → category="${cat.name}" (slug=${slug})`,
    );
  }
}
