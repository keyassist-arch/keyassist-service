import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

/**
 * Amazon PDP layout varies; a saved example lives at repo `amazon.html`.
 * Avoid `networkidle` — Amazon telemetry keeps the network busy past buybox paint.
 * For HTML similar to `amazon.html` use **`SCRAPE_PROXY`** — see `docs/SCRAPER_ARCHITECTURE.md`.
 */

/** Shape returned by page.evaluate — raw strings only */
interface AmazonRawData {
  title: string;
  payPrice: string;
  listPrice: string;
  savingsLabel: string;
  twisterPrice: string;
  a11yPrice: string;
  ldPrice: string;
  ldCurrency: string;
  metaPrice: string;
  metaCurrency: string;
  imageDataJson: string;
  fallbackImages: string[];
  brand: string;
  description: string;
  twisterJson: string;
  hasAddToCart: boolean;
  unavailableText: string;
}

interface ParsedPrice {
  current: string;
  list: string | null;
  isOnSale: boolean;
  currency: string;
}

interface AmazonVariant {
  label: string;
  asin?: string;
  available?: boolean;
}

@Injectable()
export class AmazonAdapter implements ScraperAdapter {
  readonly source = ProductSource.AMAZON;
  private readonly logger = new Logger(AmazonAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      await page
        .waitForSelector(
          [
            '#corePriceDisplay_desktop_feature_div .priceToPay',
            '#corePrice_feature_div .reinventPriceAccordionT2',
            '#productTitle',
            'h1#title',
          ].join(', '),
          { timeout: 15_000 },
        )
        .catch(() => undefined);

      await new Promise((r) => setTimeout(r, 800));

      const raw = await page.evaluate((): AmazonRawData => {
        function fromWholeFraction(el: Element): string {
          const whole = el
            .querySelector('.a-price-whole')
            ?.textContent?.replace(/[^\d]/g, '');
          if (!whole) {
            return '';
          }
          const frac =
            el
              .querySelector('.a-price-fraction')
              ?.textContent?.replace(/[^\d]/g, '') ?? '00';
          return `${whole}.${frac || '00'}`;
        }

        function fromBlock(el: Element): string {
          const off =
            el.querySelector('.a-offscreen')?.textContent?.trim() ?? '';
          if (off && /\d/.test(off)) {
            return off;
          }
          return fromWholeFraction(el);
        }

        function firstPrice(selectors: string[]): string {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) {
              continue;
            }
            const p = fromBlock(el);
            if (p) {
              return p;
            }
          }
          return '';
        }

        const payPrice = firstPrice([
          '#corePriceDisplay_desktop_feature_div .priceToPay',
          '#corePriceDisplay_desktop_feature_div .apex-pricetopay-value',
          '#apex_desktop .priceToPay',
          '#apex_desktop .apex-pricetopay-value',
          '#corePrice_feature_div .reinventPriceAccordionT2',
          '#buybox .reinventPriceAccordionT2',
          '#buybox .a-price:not(.a-text-price)',
          ...['#corePrice_feature_div', '#unifiedPrice_feature_div'].flatMap(
            (root) => [`${root} .a-price:not(.a-text-price)`],
          ),
        ]);

        const listPriceEl = document.querySelector(
          [
            '#corePriceDisplay_desktop_feature_div .a-text-price',
            '#corePrice_feature_div .a-text-price',
            '#apex_desktop .a-text-price',
            '#buybox .a-text-price',
          ].join(', '),
        );
        const listPrice = listPriceEl ? fromBlock(listPriceEl) : '';

        const savingsLabel =
          document
            .querySelector(
              '#savingsPercentage, .savingsPercentage, ' +
                '#corePriceDisplay_desktop_feature_div .a-color-price',
            )
            ?.textContent?.trim() ?? '';

        const twisterPrice =
          (
            document.querySelector(
              'input#twister-plus-price-data-price',
            ) as HTMLInputElement | null
          )?.value?.trim() ?? '';

        const a11yPrice =
          document
            .querySelector('#apex-pricetopay-accessibility-label')
            ?.textContent?.trim() ?? '';

        let ldPrice = '';
        let ldCurrency = '';
        for (const s of document.querySelectorAll(
          'script[type="application/ld+json"]',
        )) {
          try {
            const j = JSON.parse(s.textContent ?? '{}') as unknown;
            const nodes = Array.isArray(j) ? j : [j];
            for (const node of nodes) {
              if (typeof node !== 'object' || !node) {
                continue;
              }
              const o = node as Record<string, unknown>;
              const t = o['@type'];
              const isProduct =
                t === 'Product' ||
                (Array.isArray(t) && (t as string[]).includes('Product'));
              if (!isProduct) {
                continue;
              }
              const offers = o.offers;
              const offer = Array.isArray(offers) ? offers[0] : offers;
              if (offer && typeof offer === 'object') {
                const of = offer as Record<string, unknown>;
                if (of.price != null) {
                  ldPrice = String(of.price);
                }
                if (typeof of.priceCurrency === 'string') {
                  ldCurrency = of.priceCurrency;
                }
              }
              break;
            }
          } catch {
            /* skip */
          }
        }

        const metaPrice =
          document
            .querySelector('meta[itemprop="price"]')
            ?.getAttribute('content') ?? '';
        const metaCurrency =
          document
            .querySelector('meta[itemprop="priceCurrency"]')
            ?.getAttribute('content') ?? '';

        let imageDataJson = '';
        const scripts = document.querySelectorAll('script:not([src])');
        for (const s of scripts) {
          const txt = s.textContent ?? '';
          if (txt.includes("'colorImages'") || txt.includes('"colorImages"')) {
            const m2 = txt.match(
              /'colorImages'\s*:\s*(\{[\s\S]{0,8000}?\})\s*[,}]/,
            );
            if (m2) {
              imageDataJson = m2[1];
              break;
            }
          }
        }

        const seen = new Set<string>();
        const fallbackImages: string[] = [];

        for (const img of document.querySelectorAll(
          '#landingImage, #imgTagWrapperId img, #imageBlock_feature_div img',
        )) {
          const src = (img as HTMLImageElement).src
            ?.replace(/\._[A-Z0-9,_]+_\./, '.')
            .trim();
          if (src && !src.startsWith('data:') && !seen.has(src)) {
            seen.add(src);
            fallbackImages.push(src);
          }
        }
        const og = document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute('content');
        if (og && !seen.has(og)) {
          fallbackImages.push(og);
        }

        const title =
          document.querySelector('#productTitle')?.textContent?.trim() ||
          document
            .querySelector('h1#title #productTitle')
            ?.textContent?.trim() ||
          document.querySelector('h1.a-size-large')?.textContent?.trim() ||
          document
            .querySelector('meta[property="og:title"]')
            ?.getAttribute('content')
            ?.trim() ||
          document.title?.replace(/\s*:\s*Amazon\.com.*$/i, '').trim() ||
          '';

        const brand =
          document.querySelector('#bylineInfo')?.textContent?.trim() ||
          document
            .querySelector('tr.po-brand td.po-break-word')
            ?.textContent?.trim() ||
          '';

        const description =
          document.querySelector('#feature-bullets')?.textContent?.trim() ||
          document
            .querySelector('#productDescription p')
            ?.textContent?.trim() ||
          '';

        let twisterJson = '';
        for (const s of scripts) {
          const txt = s.textContent ?? '';
          if (txt.includes('twister-js-init-dpx-data')) {
            twisterJson = txt;
            break;
          }
          if (txt.includes('"variationValues"') && !twisterJson) {
            twisterJson = txt;
          }
        }

        const hasAddToCart = !!document.querySelector('#add-to-cart-button');
        const unavailableText =
          document
            .querySelector('#availability')
            ?.textContent?.trim()
            ?.toLowerCase() ?? '';

        return {
          title,
          payPrice,
          listPrice,
          savingsLabel,
          twisterPrice,
          a11yPrice,
          ldPrice,
          ldCurrency,
          metaPrice,
          metaCurrency,
          imageDataJson,
          fallbackImages,
          brand,
          description,
          twisterJson,
          hasAddToCart,
          unavailableText,
        };
      });

      const price = this.resolvePrice(raw);

      if (!raw.title || !price.current) {
        this.logger.warn(
          `AmazonAdapter: incomplete data for ${url} — title="${raw.title}" price="${price.current}". Falling back to generic.`,
        );
        return this.generic.scrape(url);
      }

      const images = this.resolveImages(raw);
      const variantRows = this.resolveAmazonVariants(raw);
      const variants = this.toProductVariants(variantRows);

      const availability = this.resolveAvailability(raw);

      const out: ScrapedProduct = {
        title: raw.title,
        price: price.current,
        currency: price.currency,
        images,
        description: raw.description || undefined,
        brand: raw.brand || undefined,
        variants,
        availability,
      };
      if (price.isOnSale && price.list) {
        out.compareAtPrice = price.list;
      }
      return out;
    } catch (err) {
      this.logger.error(
        `AmazonAdapter: scrape failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.generic.scrape(url);
    } finally {
      await context.close();
    }
  }

  private resolvePrice(raw: AmazonRawData): ParsedPrice {
    const currency = this.normaliseCurrency(
      raw.ldCurrency ||
        raw.metaCurrency ||
        this.symbolFromString(raw.payPrice) ||
        'USD',
    );

    const payStr =
      parsePriceToDecimalString(raw.payPrice) ||
      parsePriceToDecimalString(raw.a11yPrice) ||
      parsePriceToDecimalString(raw.twisterPrice) ||
      parsePriceToDecimalString(raw.ldPrice) ||
      parsePriceToDecimalString(raw.metaPrice);

    const listStr = raw.listPrice
      ? parsePriceToDecimalString(raw.listPrice)
      : null;

    const payNum = parseFloat(payStr ?? '0');
    const listNum = parseFloat(listStr ?? '0');
    const isOnSale =
      (!!listStr && listNum > payNum) ||
      (!!raw.savingsLabel && raw.savingsLabel.length > 0);

    return {
      current: payStr ?? '',
      list: isOnSale && listStr ? listStr : null,
      isOnSale,
      currency,
    };
  }

  private resolveImages(raw: AmazonRawData): string[] {
    if (raw.imageDataJson) {
      try {
        const jsonLike = raw.imageDataJson
          .replace(/'/g, '"')
          .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
        const parsed = JSON.parse(jsonLike) as Record<
          string,
          Array<{ hiRes?: string; large?: string }>
        >;

        const urls: string[] = [];
        for (const group of Object.values(parsed)) {
          if (!Array.isArray(group)) {
            continue;
          }
          for (const img of group) {
            const u = img.hiRes || img.large;
            if (u && !u.startsWith('data:')) {
              urls.push(u);
            }
          }
        }
        if (urls.length) {
          return [...new Set(urls)].slice(0, 20);
        }
      } catch {
        this.logger.debug('AmazonAdapter: could not parse colorImages JSON');
      }
    }

    return [...new Set(raw.fallbackImages)].slice(0, 20);
  }

  private resolveAmazonVariants(raw: AmazonRawData): AmazonVariant[] {
    if (!raw.twisterJson) {
      return [];
    }

    try {
      const dpxMatch = raw.twisterJson.match(
        /id="twister-js-init-dpx-data"[^>]*>(\{[\s\S]+?\})<\/script>/,
      );
      if (dpxMatch) {
        const dpx = JSON.parse(dpxMatch[1]) as {
          dimensionValues?: Record<
            string,
            | Array<{ value: string; asin?: string; is_available?: boolean }>
            | string[]
          >;
        };
        const variants: AmazonVariant[] = [];
        for (const [dim, values] of Object.entries(dpx.dimensionValues ?? {})) {
          if (!Array.isArray(values)) {
            continue;
          }
          for (const v of values) {
            if (typeof v === 'string') {
              variants.push({ label: `${dim}: ${v}` });
            } else if (v && typeof v === 'object' && 'value' in v) {
              variants.push({
                label: `${dim}: ${v.value}`,
                asin: v.asin,
                available: v.is_available,
              });
            }
          }
        }
        if (variants.length) {
          return variants;
        }
      }

      const varMatch = raw.twisterJson.match(
        /"variationValues"\s*:\s*(\{[\s\S]+?\})\s*[,}]/,
      );
      if (varMatch) {
        const variationValues = JSON.parse(varMatch[1]) as Record<
          string,
          string[]
        >;
        return Object.entries(variationValues).flatMap(([dim, values]) =>
          values.map((v) => ({ label: `${dim}: ${v}` })),
        );
      }
    } catch (err) {
      this.logger.debug(
        `AmazonAdapter: variant parse failed — ${(err as Error).message}`,
      );
    }

    return [];
  }

  /** Map flat `dim: value` labels to `{ name, options[] }` for cart / API */
  private toProductVariants(rows: AmazonVariant[]): {
    name: string;
    options: string[];
  }[] {
    const byDim = new Map<string, Set<string>>();
    for (const r of rows) {
      const sep = r.label.indexOf(': ');
      if (sep === -1) {
        continue;
      }
      const dim = r.label.slice(0, sep).trim();
      const val = r.label.slice(sep + 2).trim();
      if (!dim || !val) {
        continue;
      }
      if (!byDim.has(dim)) {
        byDim.set(dim, new Set());
      }
      byDim.get(dim)!.add(val);
    }
    return [...byDim.entries()].map(([name, opts]) => ({
      name,
      options: [...opts],
    }));
  }

  private resolveAvailability(raw: AmazonRawData): string | undefined {
    if (raw.hasAddToCart) {
      return 'In stock';
    }
    const t = raw.unavailableText;
    if (
      t.includes('unavailable') ||
      t.includes('out of stock') ||
      t.includes('currently unavailable')
    ) {
      return 'Out of stock';
    }
    if (t.length > 0) {
      return t.slice(0, 200);
    }
    return undefined;
  }

  private symbolFromString(price: string): string {
    return price.match(/[£€$₦₹¥]/)?.[0] ?? '';
  }

  private normaliseCurrency(raw: string): string {
    const symbolMap: Record<string, string> = {
      $: 'USD',
      '£': 'GBP',
      '€': 'EUR',
      '₦': 'NGN',
      '₹': 'INR',
      '¥': 'JPY',
    };
    const trimmed = raw.trim();
    return (symbolMap[trimmed] ?? trimmed).toUpperCase().slice(0, 8) || 'USD';
  }
}
