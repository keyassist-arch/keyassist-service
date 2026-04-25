import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

type RawEbayData = {
  title?: string;
  description?: string;
  brand?: string;
  currency?: string;
  ldPrice?: string;
  domPrice?: string;
  images: string[];
  conditionLabel?: string;
};

@Injectable()
export class EbayAdapter implements ScraperAdapter {
  readonly source = ProductSource.EBAY;

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
          'h1, [data-testid="ux-image-carousel-container"], script[type="application/ld+json"]',
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));

      const data = await page.evaluate((): RawEbayData => {
        const result: RawEbayData = { images: [] };

        const text = (el: Element | null | undefined): string =>
          el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const metaContent = (sel: string): string | undefined => {
          const m = document.querySelector(sel) as HTMLMetaElement | null;
          const v = m?.content?.trim();
          return v || undefined;
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
            // ignore malformed JSON-LD
          }
        }

        const isProductType = (t: unknown) =>
          t === 'Product' ||
          t === 'product' ||
          (Array.isArray(t) && t.some((x) => String(x).toLowerCase() === 'product'));
        const findProduct = (node: unknown): Record<string, unknown> | null => {
          if (!node || typeof node !== 'object') return null;
          const obj = node as Record<string, unknown>;
          if (isProductType(obj['@type'])) return obj;
          for (const value of Object.values(obj)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                const found = findProduct(item);
                if (found) return found;
              }
            } else {
              const found = findProduct(value);
              if (found) return found;
            }
          }
          return null;
        };

        const productNode = jsonLdNodes.map(findProduct).find(Boolean) ?? null;
        if (productNode) {
          if (typeof productNode.name === 'string') {
            result.title = productNode.name;
          }
          if (typeof productNode.description === 'string') {
            result.description = productNode.description;
          }
          const b = productNode.brand;
          if (typeof b === 'string') result.brand = b;
          else if (b && typeof b === 'object') {
            const name = (b as { name?: unknown }).name;
            if (typeof name === 'string') result.brand = name;
          }
          const imgs = Array.isArray(productNode.image)
            ? productNode.image
            : productNode.image
              ? [productNode.image]
              : [];
          result.images.push(
            ...imgs.map((x) => String(x)).filter((x) => /^https?:\/\//i.test(x)),
          );
          const offers = productNode.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer && typeof offer === 'object') {
            const o = offer as Record<string, unknown>;
            if (o.price != null) result.ldPrice = String(o.price);
            if (o.priceCurrency != null) result.currency = String(o.priceCurrency);
            if (o.itemCondition != null) result.conditionLabel = String(o.itemCondition);
          }
        }

        if (!result.title) {
          result.title =
            text(document.querySelector('h1')) ||
            metaContent('meta[property="og:title"]') ||
            metaContent('meta[name="twitter:title"]');
        }
        if (!result.description) {
          result.description =
            metaContent('meta[name="description"]') ||
            metaContent('meta[property="og:description"]') ||
            metaContent('meta[name="twitter:description"]');
        }

        if (!result.images.length) {
          const domImages = Array.from(
            document.querySelectorAll('img[src*="ebayimg.com"], img[data-zoom-src*="ebayimg.com"]'),
          )
            .map((img) =>
              (img as HTMLImageElement).src ||
              (img as HTMLImageElement).getAttribute('data-zoom-src') ||
              '',
            )
            .filter(Boolean);
          result.images.push(...domImages);
        }
        if (!result.images.length) {
          const og = metaContent('meta[property="og:image"]');
          if (og) result.images.push(og);
        }

        const priceCandidates = Array.from(
          document.querySelectorAll(
            '[itemprop="price"], .x-price-primary, .ux-textspans--BOLD, [data-testid*="price"]',
          ),
        )
          .map((el) => text(el))
          .filter(Boolean);
        result.domPrice =
          priceCandidates.find((p) => /\d/.test(p) && /[$£€₦]|[A-Z]{3}/.test(p)) ??
          undefined;

        if (!result.currency) {
          const cur =
            (document.querySelector('[itemprop="priceCurrency"]') as HTMLElement | null)
              ?.getAttribute('content') ||
            undefined;
          if (cur) result.currency = cur;
        }

        return result;
      });

      const priceRaw = data.ldPrice || data.domPrice || '';
      const normalizedPrice = parsePriceToDecimalString(priceRaw);
      if (data.title && normalizedPrice) {
        const description =
          data.conditionLabel && data.description
            ? `${data.description}\n\nCondition: ${data.conditionLabel}`
            : data.description ?? data.conditionLabel;
        return {
          title: data.title,
          price: normalizedPrice,
          currency: (data.currency || 'USD').toUpperCase(),
          images: [...new Set(data.images)].slice(0, 24),
          description,
          brand: data.brand,
          variants: [],
        };
      }
    } catch {
      // fall through
    } finally {
      await context.close();
    }

    return this.generic.scrape(url);
  }
}

