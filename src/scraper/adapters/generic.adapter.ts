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
    const context = await this.playwright.newScrapeContext({}, url);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() =>
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }),
      );
      await new Promise((r) => setTimeout(r, 1200));
      await page.evaluate(() => window.scrollTo(0, 400)).catch(() => undefined);

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

        const isProductType = (t: unknown) =>
          t === 'Product' ||
          t === 'product' ||
          (Array.isArray(t) && t.includes('Product'));

        const absorbOffer = (offer: Record<string, unknown> | null) => {
          if (!offer) return;
          let p = offer.price ?? offer.lowPrice;
          const ps = offer.priceSpecification;
          if (p == null && ps && typeof ps === 'object') {
            const q = ps as Record<string, unknown>;
            p = q.price ?? q.value;
          }
          if (p != null && result.price == null) result.price = String(p);
          const cur = offer.priceCurrency as string | undefined;
          if (cur && !result.currency) result.currency = cur;
        };

        const absorbProduct = (node: Record<string, unknown>) => {
          if (node.name && typeof node.name === 'string' && !result.title) {
            result.title = node.name;
          }
          const offers = node.offers;
          if (offers) {
            const offer = Array.isArray(offers) ? offers[0] : offers;
            if (offer && typeof offer === 'object') {
              absorbOffer(offer as Record<string, unknown>);
            }
          }
          if (node.image) {
            const imgs = Array.isArray(node.image) ? node.image : [node.image];
            result.images.push(...imgs.filter(Boolean));
          }
          if (typeof node.description === 'string' && !result.description) {
            result.description = node.description;
          }
          const b = node.brand;
          if (typeof b === 'string' && !result.brand) result.brand = b;
          else if (b && typeof b === 'object' && (b as { name?: string }).name) {
            result.brand = (b as { name: string }).name;
          }
        };

        const walkJsonLd = (node: unknown): void => {
          if (node == null) return;
          if (Array.isArray(node)) {
            for (const x of node) walkJsonLd(x);
            return;
          }
          if (typeof node !== 'object') return;
          const o = node as Record<string, unknown>;
          if (isProductType(o['@type'])) {
            absorbProduct(o);
          }
          if (o['@type'] === 'Offer' || o['@type'] === 'AggregateOffer') {
            absorbOffer(o);
          }
          const g = o['@graph'];
          if (Array.isArray(g)) {
            for (const x of g) walkJsonLd(x);
          }
          for (const v of Object.values(o)) {
            if (v && typeof v === 'object') walkJsonLd(v);
          }
        };

        const ldScripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        );
        for (const s of ldScripts) {
          try {
            const json = JSON.parse(s.textContent || '{}');
            walkJsonLd(json);
          } catch {
            /* skip invalid JSON-LD */
          }
        }

        const ogTitle =
          document
            .querySelector('meta[property="og:title"]')
            ?.getAttribute('content') ||
          document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
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

        if (!result.title) {
          const h1 =
            document.querySelector('h1')?.textContent?.trim() ||
            document.querySelector('[data-qa-article="product"] h1')
              ?.textContent?.trim();
          if (h1) {
            result.title = h1.split('\n')[0].trim().slice(0, 300);
          }
        }

        if (!result.price) {
          const body = document.body?.innerText ?? '';
          let m = body.match(/(\d+[.,]\d{2})\s*(EUR|USD|GBP|CHF|ZAR)\b/i);
          if (m) {
            result.price = m[1];
            result.currency = m[2].toUpperCase();
          } else {
            m = body.match(/\b(EUR|USD|GBP|CHF|ZAR)\s*(\d+[.,]\d{2})\b/i);
            if (m) {
              result.currency = m[1].toUpperCase();
              result.price = m[2];
            }
          }
        }

        if (result.title && result.title.includes('|')) {
          result.title = result.title.split('|')[0].trim();
        }

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
