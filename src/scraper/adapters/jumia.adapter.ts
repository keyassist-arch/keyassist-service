import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

@Injectable()
export class JumiaAdapter implements ScraperAdapter {
  readonly source = ProductSource.JUMIA;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36',
    }, url);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const data = await page.evaluate(() => {
        const title =
          document.querySelector('h1')?.textContent?.trim() ||
          document
            .querySelector('[data-testid="product-name"]')
            ?.textContent?.trim();
        const priceEl =
          document.querySelector('.prc') ||
          document.querySelector('[data-price]') ||
          document.querySelector('.-fs20.-pts.-pbxs');
        const price =
          priceEl?.getAttribute('data-price') || priceEl?.textContent || '';
        const imgs = Array.from(
          document.querySelectorAll(
            '#imgs img, .gallery-img img, [data-testid="image-thumbnail"] img',
          ),
        )
          .map((img) => (img as HTMLImageElement).src)
          .filter(Boolean);
        const desc = document
          .querySelector('#product-details, .product-details')
          ?.textContent?.trim();
        return { title, price, images: imgs, description: desc };
      });
      const priceStr = parsePriceToDecimalString(data.price);
      if (data.title && priceStr) {
        return {
          title: data.title,
          price: priceStr,
          currency: 'NGN',
          images: [...new Set(data.images)].slice(0, 20),
          description: data.description,
          variants: [],
        };
      }
    } catch {
      /* fall through */
    } finally {
      await context.close();
    }
    return this.generic.scrape(url);
  }
}
