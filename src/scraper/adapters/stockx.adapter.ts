import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';
import { currencyFromPriceString } from '../utils/currency-symbol.util';

type RawStockxData = {
  title?: string;
  description?: string;
  brand?: string;
  currency?: string;
  ldPrice?: string;
  lowestAsk?: string;
  images: string[];
  sizes: string[];
};

@Injectable()
export class StockxAdapter implements ScraperAdapter {
  readonly source = ProductSource.STOCKX;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext(
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
      url,
    );
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .waitForSelector(
          'h1, [data-testid="product-view"], meta[property="og:title"]',
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1200));

      const data = await page.evaluate((): RawStockxData => {
        const result: RawStockxData = { images: [], sizes: [] };

        const text = (el: Element | null | undefined): string =>
          el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

        const metaContent = (sel: string): string | undefined => {
          const el = document.querySelector(sel) as HTMLMetaElement | null;
          const value = el?.content?.trim();
          return value || undefined;
        };

        const jsonLdNodes: Record<string, unknown>[] = [];
        for (const script of Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        )) {
          const raw = script.textContent?.trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of arr) {
              if (node && typeof node === 'object') {
                jsonLdNodes.push(node as Record<string, unknown>);
              }
            }
          } catch {
            // Ignore malformed JSON-LD blocks.
          }
        }

        const isProductType = (t: unknown) =>
          t === 'Product' ||
          t === 'product' ||
          (Array.isArray(t) &&
            t.some((x) => String(x).toLowerCase() === 'product'));

        const walkForProduct = (
          node: unknown,
        ): Record<string, unknown> | null => {
          if (!node || typeof node !== 'object') return null;
          const obj = node as Record<string, unknown>;
          if (isProductType(obj['@type'])) return obj;
          for (const value of Object.values(obj)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                const found = walkForProduct(item);
                if (found) return found;
              }
            } else {
              const found = walkForProduct(value);
              if (found) return found;
            }
          }
          return null;
        };

        const productNode =
          jsonLdNodes.map((n) => walkForProduct(n)).find(Boolean) ?? null;

        if (productNode) {
          if (typeof productNode.name === 'string')
            result.title = productNode.name;
          if (typeof productNode.description === 'string') {
            result.description = productNode.description;
          }
          const b = productNode.brand;
          if (typeof b === 'string') result.brand = b;
          else if (
            b &&
            typeof b === 'object' &&
            typeof (b as { name?: unknown }).name === 'string'
          ) {
            result.brand = (b as { name: string }).name;
          }
          const image = productNode.image;
          const imgs = Array.isArray(image) ? image : image ? [image] : [];
          result.images.push(
            ...imgs
              .map((x) => String(x))
              .filter((x) => /^https?:\/\//i.test(x)),
          );
          const offers = productNode.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer && typeof offer === 'object') {
            const o = offer as Record<string, unknown>;
            if (o.price != null) result.ldPrice = String(o.price);
            if (o.priceCurrency != null)
              result.currency = String(o.priceCurrency);
          }
        }

        if (!result.title) {
          result.title =
            text(document.querySelector('h1')) ||
            metaContent('meta[property="og:title"]') ||
            metaContent('meta[name="title"]');
        }
        if (!result.description) {
          result.description =
            metaContent('meta[name="description"]') ||
            metaContent('meta[property="og:description"]');
        }
        if (!result.images.length) {
          const imageCandidates = Array.from(
            document.querySelectorAll('img[src*="images.stockx.com"]'),
          )
            .map((img) => (img as HTMLImageElement).src)
            .filter(Boolean);
          result.images.push(...imageCandidates);
        }
        if (!result.images.length) {
          const ogImage = metaContent('meta[property="og:image"]');
          if (ogImage) result.images.push(ogImage);
        }

        const moneyRegex =
          /([A-Z]{3}\s*)?[$£€₦]\s?[\d,]+(?:\.\d{1,2})?|([A-Z]{3})\s*[\d,]+(?:\.\d{1,2})?/;
        const labels = Array.from(
          document.querySelectorAll('div,span,p,strong,h2,h3'),
        );
        for (const labelEl of labels) {
          const label = text(labelEl);
          if (!/lowest ask/i.test(label)) continue;
          const parent = labelEl.parentElement;
          const neighborhood = [
            parent,
            parent?.nextElementSibling ?? null,
            labelEl.nextElementSibling,
            parent?.parentElement ?? null,
          ];
          for (const n of neighborhood) {
            const candidate = text(n);
            const m = candidate.match(moneyRegex);
            if (m) {
              result.lowestAsk = m[0];
              break;
            }
          }
          if (result.lowestAsk) break;
        }

        const sizeCandidates = Array.from(
          document.querySelectorAll(
            'button[aria-label*="US"], button[data-testid*="size"], [data-testid*="size"] button',
          ),
        )
          .map((el) => text(el))
          .filter(Boolean);
        result.sizes = Array.from(new Set(sizeCandidates)).slice(0, 60);

        return result;
      });

      const priceRaw = data.lowestAsk || data.ldPrice || '';
      const normalizedPrice = parsePriceToDecimalString(priceRaw);
      if (data.title && normalizedPrice) {
        return {
          title: data.title,
          price: normalizedPrice,
          currency: (
            currencyFromPriceString(data.lowestAsk ?? data.ldPrice ?? '') ||
            data.currency ||
            'USD'
          ).toUpperCase(),
          images: [...new Set(data.images)].slice(0, 24),
          description: data.description,
          brand: data.brand,
          availability: 'in_stock',
          variants: data.sizes.length
            ? [{ name: 'Size', options: data.sizes }]
            : [],
        };
      }
    } catch {
      // Fall through to generic adapter.
    } finally {
      await context.close();
    }

    return this.generic.scrape(url);
  }
}
