import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

/**
 * StockX page structure notes (as of 2026-05):
 *  - Product metadata (title, brand, description, sizes, images, retail price) is
 *    server-rendered inside __NEXT_DATA__ → props.pageProps.req.appContext.states.query
 *    .value.queries[GetProduct].state.data.product.
 *  - Market prices (lowest ask) are fetched client-side after React hydration and are
 *    NOT present in the raw SSR HTML.
 *  - JSON-LD only contains BreadcrumbList — there is no Product JSON-LD on StockX.
 *  - Direct HTTP/Playwright without a proxy gets blocked (403 / Cloudflare challenge).
 *  - Set SCRAPE_DO_TOKEN to route through scrape.do's render API, which handles bot
 *    bypass and renders JavaScript so the live market price is present in the HTML.
 *    Alternatively set SCRAPE_PROXY to any residential proxy and Playwright will use it.
 */

type StockxExtracted = {
  title?: string;
  brand?: string;
  description?: string;
  retailPrice?: string;
  lowestAskRaw?: string;
  images: string[];
  sizes: string[];
};

function parseNextDataFromHtml(html: string): StockxExtracted | null {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    const nd = JSON.parse(match[1]) as Record<string, unknown>;
    const queries: unknown[] =
      (nd as any)?.props?.pageProps?.req?.appContext?.states?.query?.value?.queries ?? [];

    const productQuery = queries.find((q: any) => q?.queryKey?.[0] === 'GetProduct') as any;
    const product = productQuery?.state?.data?.product as Record<string, unknown> | undefined;
    if (!product?.title) return null;

    const result: StockxExtracted = { images: [], sizes: [] };
    result.title = typeof product.title === 'string' ? product.title : undefined;
    result.brand = typeof product.brand === 'string' ? product.brand : undefined;
    if (typeof product.description === 'string') {
      result.description = product.description
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const media = product.media as Record<string, unknown> | undefined;
    if (media) {
      if (typeof media.imageUrl === 'string') result.images.push(media.imageUrl);
      if (typeof media.smallImageUrl === 'string') result.images.push(media.smallImageUrl);
      const gallery = Array.isArray(media.gallery) ? (media.gallery as any[]) : [];
      for (const g of gallery.slice(0, 6)) {
        if (typeof g === 'string') result.images.push(g);
        else if (g?.url && typeof g.url === 'string') result.images.push(g.url as string);
      }
    }

    const traits = Array.isArray(product.traits) ? (product.traits as any[]) : [];
    const retailTrait = traits.find(
      (t: any) => t?.name === 'Retail Price' && t?.format === 'currency',
    );
    if (retailTrait?.value) result.retailPrice = String(retailTrait.value);

    const variants = Array.isArray(product.variants) ? (product.variants as any[]) : [];
    for (const v of variants) {
      const size = v?.traits?.size;
      if (size != null) result.sizes.push(`US ${size}`);
    }

    return result;
  } catch {
    return null;
  }
}

/** Try to read a market price from the rendered HTML (only present if JS executed fully). */
function parseLivePrice(html: string): string | undefined {
  // Look for dollar amounts near "Lowest Ask" text in the rendered HTML.
  const moneyRe = /\$\s*[\d,]+(?:\.\d{1,2})?/g;

  // StockX renders "Lowest Ask" as visible text in the buy container after hydration.
  const lowestAskIdx = html.search(/lowest\s+ask/i);
  if (lowestAskIdx >= 0) {
    const nearby = html.slice(lowestAskIdx, lowestAskIdx + 300);
    const m = nearby.match(moneyRe);
    if (m) return m[0];
  }

  return undefined;
}

@Injectable()
export class StockxAdapter implements ScraperAdapter {
  private readonly logger = new Logger(StockxAdapter.name);
  readonly source = ProductSource.STOCKX;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fetch via scrape.do render API — handles Cloudflare/bot protection, executes JS,
   * and waits for the price to load.  Only used when SCRAPE_DO_TOKEN is configured.
   */
  private async fetchViaScrapeDoApi(url: string): Promise<StockxExtracted | null> {
    const token = this.config.get<string>('SCRAPE_DO_TOKEN')?.trim();
    if (!token) return null;

    try {
      const params = new URLSearchParams({
        token,
        url,
        super: 'true',
        // Wait 8 s after page load for the market-price API call to complete.
        wait: '8000',
      });
      const { data: html } = await axios.get<string>(
        `http://api.scrape.do/?${params.toString()}`,
        {
          timeout: 60_000,
          maxContentLength: 10_000_000,
          headers: { Accept: 'text/html' },
          validateStatus: (s) => s >= 200 && s < 400,
        },
      );

      if (typeof html !== 'string' || html.length < 1000) return null;

      const extracted = parseNextDataFromHtml(html);
      if (!extracted) {
        this.logger.warn('[stockx] scrape.do returned HTML but no __NEXT_DATA__ product');
        return null;
      }

      // Prices are rendered by JS after the wait — try to read from the HTML.
      extracted.lowestAskRaw = parseLivePrice(html);

      // og:image fallback for images
      if (!extracted.images.length) {
        const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
        if (ogMatch) extracted.images.push(ogMatch[1]);
      }

      this.logger.log(
        `[stockx] scrape.do step=done title="${extracted.title}" ` +
          `lowestAsk=${extracted.lowestAskRaw ?? 'none'} retailPrice=${extracted.retailPrice ?? 'none'}`,
      );
      return extracted;
    } catch (e) {
      this.logger.warn(
        `[stockx] scrape.do fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Fallback: use Playwright directly (works with SCRAPE_PROXY or residential IPs). */
  private async fetchViaPlaywright(url: string): Promise<StockxExtracted | null> {
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
        .waitForSelector('[data-testid="product-view"], [data-testid="BuySellContainerStandard"]', {
          timeout: 20_000,
        })
        .catch(() => undefined);

      const extracted = await page.evaluate((): StockxExtracted => {
        const result: StockxExtracted = { images: [], sizes: [] };

        const metaContent = (sel: string): string | undefined => {
          const el = document.querySelector(sel) as HTMLMetaElement | null;
          return el?.content?.trim() || undefined;
        };

        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl?.textContent) {
          try {
            const nd = JSON.parse(nextDataEl.textContent) as Record<string, unknown>;
            const queries: unknown[] =
              (nd as any)?.props?.pageProps?.req?.appContext?.states?.query?.value?.queries ?? [];
            const productQuery = queries.find(
              (q: any) => q?.queryKey?.[0] === 'GetProduct',
            ) as any;
            const product = productQuery?.state?.data?.product as
              | Record<string, unknown>
              | undefined;

            if (product) {
              if (typeof product.title === 'string') result.title = product.title;
              if (typeof product.brand === 'string') result.brand = product.brand;
              if (typeof product.description === 'string') {
                result.description = (product.description as string)
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
              }
              const media = product.media as Record<string, unknown> | undefined;
              if (media) {
                if (typeof media.imageUrl === 'string') result.images.push(media.imageUrl);
                if (typeof media.smallImageUrl === 'string')
                  result.images.push(media.smallImageUrl);
                const gallery = Array.isArray(media.gallery) ? (media.gallery as any[]) : [];
                for (const g of gallery.slice(0, 6)) {
                  if (typeof g === 'string') result.images.push(g);
                  else if (g?.url && typeof g.url === 'string')
                    result.images.push(g.url as string);
                }
              }
              const traits = Array.isArray(product.traits) ? (product.traits as any[]) : [];
              const retailTrait = traits.find(
                (t: any) => t?.name === 'Retail Price' && t?.format === 'currency',
              );
              if (retailTrait?.value) result.retailPrice = String(retailTrait.value);
              const variants = Array.isArray(product.variants) ? (product.variants as any[]) : [];
              for (const v of variants) {
                const size = v?.traits?.size;
                if (size != null) result.sizes.push(`US ${size}`);
              }
            }
          } catch {
            // parse failure
          }
        }

        if (!result.title) {
          result.title =
            metaContent('meta[property="og:title"]') ||
            metaContent('meta[name="twitter:title"]') ||
            document.querySelector('h1')?.textContent?.trim();
        }
        if (!result.description) {
          result.description =
            metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]');
        }
        if (!result.images.length) {
          const ogImage = metaContent('meta[property="og:image"]');
          if (ogImage) result.images.push(ogImage);
        }
        return result;
      });

      if (!extracted.title) return null;

      // Wait for live price (best-effort, 15 s)
      const priceLoaded = await page
        .waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="BuySellContainerStandard"]');
            return el != null && /\$\d/.test(el.textContent ?? '');
          },
          { timeout: 15_000 },
        )
        .catch(() => null);

      if (priceLoaded) {
        extracted.lowestAskRaw = await page.evaluate((): string | undefined => {
          const buyArea = document.querySelector('[data-testid="BuySellContainerStandard"]');
          if (!buyArea) return undefined;
          const moneyRe = /\$\s*[\d,]+(?:\.\d{1,2})?/;
          for (const el of Array.from(buyArea.querySelectorAll('*'))) {
            const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!/lowest ask/i.test(t) || t.length > 80) continue;
            const candidates = [
              el.nextElementSibling,
              el.parentElement?.nextElementSibling,
              el.parentElement,
            ];
            for (const c of candidates) {
              if (!c) continue;
              const ct = (c.textContent ?? '').trim();
              const m = ct.match(moneyRe);
              if (m && ct.length < 30) return m[0];
            }
          }
          const m = (buyArea.textContent ?? '').match(moneyRe);
          return m ? m[0] : undefined;
        });
      } else {
        this.logger.warn('[stockx] playwright: live price not loaded — using retail price');
      }

      return extracted;
    } catch (e) {
      this.logger.warn(
        `[stockx] playwright error: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    } finally {
      await context.close();
    }
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    // Prefer scrape.do API (bypasses bot detection); fall back to Playwright.
    const extracted =
      (await this.fetchViaScrapeDoApi(url)) ?? (await this.fetchViaPlaywright(url));

    if (!extracted?.title) {
      this.logger.warn(`[stockx] no product data — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    const priceSource = extracted.lowestAskRaw ? 'lowestAsk' : 'retailPrice';
    const priceRaw = extracted.lowestAskRaw ?? (extracted.retailPrice ? `$${extracted.retailPrice}` : '');
    const normalizedPrice = parsePriceToDecimalString(priceRaw);

    if (!normalizedPrice) {
      this.logger.warn(`[stockx] no price — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    const uniqueImages = [
      ...new Set(extracted.images.filter((u) => /^https?:\/\//i.test(u))),
    ].slice(0, 24);

    this.logger.log(
      `[stockx] url=${url} title="${extracted.title}" price=${normalizedPrice} ` +
        `source=${priceSource} sizes=${extracted.sizes.length}`,
    );

    return {
      title: extracted.title,
      price: normalizedPrice,
      currency: 'USD',
      brand: extracted.brand,
      description: extracted.description,
      images: uniqueImages,
      availability: 'in_stock',
      variants: extracted.sizes.length ? [{ name: 'Size', options: extracted.sizes }] : [],
    };
  }
}
