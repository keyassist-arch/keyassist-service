import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

@Injectable()
export class GenericAdapter implements ScraperAdapter {
  readonly source = ProductSource.GENERIC;

  constructor(private readonly playwright: PlaywrightService) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const data = await page.evaluate(() => {
        const result: {
          title?: string;
          price?: string;
          currency?: string;
          images: string[];
          description?: string;
          brand?: string;
          availability?: string;
        } = { images: [] };

        const ldScripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        );
        for (const s of ldScripts) {
          try {
            const json = JSON.parse(s.textContent || '{}');
            const nodes = Array.isArray(json) ? json : [json];
            for (const node of nodes) {
              if (node['@type'] === 'Product' || node['@type'] === 'product') {
                result.title = node.name || result.title;
                const offers = node.offers;
                const offer = Array.isArray(offers) ? offers[0] : offers;
                if (offer?.price) result.price = String(offer.price);
                if (offer?.priceCurrency) result.currency = offer.priceCurrency;
                if (node.image) {
                  const imgs = Array.isArray(node.image)
                    ? node.image
                    : [node.image];
                  result.images.push(...imgs.filter(Boolean));
                }
                result.description = node.description || result.description;
                result.brand =
                  typeof node.brand === 'string'
                    ? node.brand
                    : node.brand?.name || result.brand;
              }
            }
          } catch {
            /* skip invalid JSON-LD */
          }
        }

        const ogTitle =
          document
            .querySelector('meta[property="og:title"]')
            ?.getAttribute('content') ||
          document.querySelector('title')?.textContent;
        if (ogTitle) result.title = result.title || ogTitle.trim();

        const ogImage =
          document
            .querySelector('meta[property="og:image"]')
            ?.getAttribute('content') || undefined;
        if (ogImage) result.images.push(ogImage);

        const ogDesc = document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute('content');
        if (ogDesc) result.description = result.description || ogDesc;

        const priceMeta =
          document
            .querySelector('meta[property="product:price:amount"]')
            ?.getAttribute('content') ||
          document
            .querySelector('meta[itemprop="price"]')
            ?.getAttribute('content');
        if (priceMeta) result.price = result.price || priceMeta;

        const currencyMeta =
          document
            .querySelector('meta[property="product:price:currency"]')
            ?.getAttribute('content') ||
          document
            .querySelector('meta[itemprop="priceCurrency"]')
            ?.getAttribute('content');
        if (currencyMeta) result.currency = result.currency || currencyMeta;

        return result;
      });

      const priceParsed = data.price
        ? parsePriceToDecimalString(data.price)
        : null;
      if (!data.title || !priceParsed) {
        throw new Error(
          'Generic scraper could not extract required title/price from page',
        );
      }

      return {
        title: data.title,
        price: priceParsed,
        currency: (data.currency || 'USD').toUpperCase().slice(0, 8),
        images: [...new Set(data.images)].filter(Boolean).slice(0, 20),
        description: data.description,
        brand: data.brand,
        variants: [],
        availability: data.availability,
      };
    } finally {
      await context.close();
    }
  }
}
