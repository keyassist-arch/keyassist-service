import { ProductSource } from '../../common/enums/product-source.enum';
import { ScrapedProduct } from './scraped-product.interface';

export interface ScraperAdapter {
  readonly source: ProductSource;
  scrape(url: string): Promise<ScrapedProduct>;
}
