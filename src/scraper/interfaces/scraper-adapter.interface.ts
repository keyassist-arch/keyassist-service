import { ProductSource } from '../../common/enums/product-source.enum';
import { ScrapedProduct } from './scraped-product.interface';

export const SCRAPER_ADAPTER_TOKEN = Symbol('SCRAPER_ADAPTER_TOKEN');

export interface ScraperAdapter {
  readonly source: ProductSource;
  scrape(url: string): Promise<ScrapedProduct>;
}
