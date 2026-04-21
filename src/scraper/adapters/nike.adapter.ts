import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

@Injectable()
export class NikeAdapter implements ScraperAdapter {
  readonly source = ProductSource.NIKE;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    }, url);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      const data = await page.evaluate(() => {
        const title =
          document
            .querySelector('[data-testid="product_title"]')
            ?.textContent?.trim() ||
          document.querySelector('h1')?.textContent?.trim();
        const priceText =
          document.querySelector('[data-testid="currentPrice-container"]')
            ?.textContent ||
          document.querySelector('[data-test="product-price"]')?.textContent ||
          '';
        const imgs = Array.from(
          document.querySelectorAll('img[alt*="Product"], picture img'),
        )
          .map((img) => (img as HTMLImageElement).src)
          .filter((s) => s && !s.includes('data:'));
        return { title, priceText, images: imgs };
      });
      const priceStr = parsePriceToDecimalString(data.priceText);
      if (data.title && priceStr) {
        return {
          title: data.title,
          price: priceStr,
          currency: 'USD',
          images: [...new Set(data.images)].slice(0, 20),
          brand: 'Nike',
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
