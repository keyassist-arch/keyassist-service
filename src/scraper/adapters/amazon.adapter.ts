import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';
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
  /** Hidden input `#ASIN` — reliable page-level ASIN. */
  asin: string;
  /** `#acrPopover` title attribute, e.g. "4.4 out of 5 stars". */
  rating: string;
  /** `#acrCustomerReviewText` aria-label, e.g. "946 Reviews". */
  reviewCount: string;
  /** JSON-stringified `[key, value][]` pairs from the product overview spec table. */
  productSpecsJson: string;
  /** Seller/ship-from name from the buybox merchant block. */
  sellerName: string;
}

interface ParsedPrice {
  current: string;
  list: string | null;
  isOnSale: boolean;
  currency: string;
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
    const { page, context } = await this.playwright.loadPage(url, {
      contextOverrides: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        locale: 'en-US',
      },
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45_000 },
    });

    try {

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
        let twisterFinal = false;
        const scripts = document.querySelectorAll('script:not([src])');
        for (const s of scripts) {
          const txt = s.textContent ?? '';
          if (
            !imageDataJson &&
            (txt.includes("'colorImages'") || txt.includes('"colorImages"'))
          ) {
            const m2 = txt.match(
              /'colorImages'\s*:\s*(\{[\s\S]{0,8000}?\})\s*[,}]/,
            );
            if (m2) imageDataJson = m2[1];
          }
          if (!twisterFinal) {
            if (txt.includes('twister-js-init-dpx-data')) {
              twisterJson = txt;
              twisterFinal = true;
            } else if (txt.includes('"variationValues"') && !twisterJson) {
              twisterJson = txt;
            }
          }
          if (imageDataJson && twisterFinal) break;
        }

        const hasAddToCart = !!document.querySelector('#add-to-cart-button');
        const unavailableText =
          document
            .querySelector('#availability')
            ?.textContent?.trim()
            ?.toLowerCase() ?? '';

        // ASIN from hidden input (reliable across page layouts).
        const asin =
          (document.querySelector('input#ASIN') as HTMLInputElement | null)
            ?.value?.trim() ?? '';

        // Rating and review count.
        const rating =
          document
            .querySelector('#acrPopover')
            ?.getAttribute('title')
            ?.trim() ?? '';
        const reviewCount =
          document
            .querySelector('#acrCustomerReviewText')
            ?.getAttribute('aria-label')
            ?.trim() ||
          document
            .querySelector('#acrCustomerReviewText')
            ?.textContent?.replace(/[()]/g, '')
            .trim() ||
          '';

        // Product overview spec table → [[key, value], ...]
        const specsEntries: [string, string][] = [];
        const overviewDiv = document.querySelector(
          '#productOverview_feature_div',
        );
        if (overviewDiv) {
          for (const row of overviewDiv.querySelectorAll('tr')) {
            const key =
              row.querySelector('span.a-text-bold')?.textContent?.trim() ?? '';
            const val =
              row.querySelector('span.po-break-word')?.textContent?.trim() ??
              '';
            if (key && val) specsEntries.push([key, val]);
          }
        }
        const productSpecsJson = JSON.stringify(specsEntries);

        // Seller name from the buybox merchant block.
        const sellerName =
          document
            .querySelector('#merchant-info a span')
            ?.textContent?.trim() ||
          document
            .querySelector('.offer-display-feature-text-message')
            ?.textContent?.trim() ||
          '';

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
          asin,
          rating,
          reviewCount,
          productSpecsJson,
          sellerName,
        };
      });

      const price = this.resolvePrice(raw, url);

      if (!raw.title || !price.current) {
        this.logger.warn(
          `AmazonAdapter: incomplete data for ${url} — title="${raw.title}" price="${price.current}". Falling back to generic.`,
        );
        return this.generic.scrape(url);
      }

      // Parse spec table: [[key, value], ...]
      let productSpecs: [string, string][] = [];
      try {
        productSpecs = JSON.parse(raw.productSpecsJson) as [string, string][];
      } catch {
        /* ignore */
      }

      // Brand: prefer spec table (clean name like "LG") over bylineInfo ("Visit the LG Store").
      const specBrand = productSpecs.find(
        ([k]) => k.toLowerCase() === 'brand',
      )?.[1];
      const brand = specBrand || this.cleanBrand(raw.brand) || undefined;

      const images = this.resolveImages(raw);
      const { variants, configurationPrices, currentAsin } =
        this.parseTwisterData(raw.twisterJson, price.current);
      const asin = currentAsin || raw.asin || undefined;
      const availability = this.resolveAvailability(raw);
      const description = this.buildDescription(raw, productSpecs);

      return {
        title: raw.title,
        price: price.current,
        currency: price.currency,
        images,
        description: description || undefined,
        brand,
        asin,
        variants,
        ...(configurationPrices.length ? { configurationPrices } : {}),
        availability,
      };
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

  private currencyFromAmazonUrl(url: string): string {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      const map: Record<string, string> = {
        'amazon.com.ng': 'NGN',
        'amazon.co.uk': 'GBP',
        'amazon.de': 'EUR',
        'amazon.fr': 'EUR',
        'amazon.it': 'EUR',
        'amazon.es': 'EUR',
        'amazon.nl': 'EUR',
        'amazon.com.be': 'EUR',
        'amazon.pl': 'PLN',
        'amazon.se': 'SEK',
        'amazon.co.jp': 'JPY',
        'amazon.in': 'INR',
        'amazon.com.br': 'BRL',
        'amazon.ca': 'CAD',
        'amazon.com.au': 'AUD',
        'amazon.com.mx': 'MXN',
        'amazon.com.tr': 'TRY',
        'amazon.com.eg': 'EGP',
        'amazon.sa': 'SAR',
        'amazon.ae': 'AED',
        'amazon.sg': 'SGD',
      };
      return map[host] ?? '';
    } catch {
      return '';
    }
  }

  private resolvePrice(raw: AmazonRawData, url: string): ParsedPrice {
    // Priority: symbol in price text → domain mapping → structured data.
    // Amazon regional sites (e.g. amazon.com.ng) frequently emit
    // priceCurrency:"USD" in JSON-LD even when displaying local-currency prices.
    // Domain mapping is the most reliable fallback when the symbol is absent
    // (fromWholeFraction strips non-digit chars, so the ₦/£/€ glyph can be lost).
    const currency = this.normaliseCurrency(
      this.symbolFromString(raw.payPrice) ||
        this.symbolFromString(raw.a11yPrice) ||
        this.symbolFromString(raw.listPrice) ||
        this.currencyFromAmazonUrl(url) ||
        raw.ldCurrency ||
        raw.metaCurrency ||
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

  /**
   * Parse Amazon's twister script to extract variants (with display labels), per-ASIN
   * configurationPrices, and the current page ASIN.
   *
   * Targets the inline `P.register('twister-js-init-dpx-data', ...)` block.
   * Falls back to a plain `variationValues` scan when the richer data is absent.
   */
  private parseTwisterData(
    twisterJson: string,
    currentPrice: string,
  ): {
    variants: { name: string; options: string[] }[];
    configurationPrices: ProductConfigurationPrice[];
    currentAsin: string;
  } {
    if (!twisterJson) {
      return { variants: [], configurationPrices: [], currentAsin: '' };
    }

    // --- individual field extraction via targeted regex ---

    let variationValues: Record<string, string[]> = {};
    const varMatch = twisterJson.match(
      /"variationValues"\s*:\s*(\{[\s\S]+?\})\s*[,}]/,
    );
    if (varMatch) {
      try {
        variationValues = JSON.parse(varMatch[1]) as Record<string, string[]>;
      } catch {
        /* */
      }
    }

    let displayLabels: Record<string, string> = {};
    const labelMatch = twisterJson.match(
      /"variationDisplayLabels"\s*:\s*(\{[^}]+\})/,
    );
    if (labelMatch) {
      try {
        displayLabels = JSON.parse(labelMatch[1]) as Record<string, string>;
      } catch {
        /* */
      }
    }

    // `dimensions` preserves the declared order of dimension keys.
    let dimensions: string[] = Object.keys(variationValues);
    const dimArrMatch = twisterJson.match(/"dimensions"\s*:\s*(\[[^\]]+\])/);
    if (dimArrMatch) {
      try {
        const parsed = JSON.parse(dimArrMatch[1]) as string[];
        if (parsed.length) dimensions = parsed;
      } catch {
        /* */
      }
    }

    let dimToAsin: Record<string, string> = {};
    const dimAsinMatch = twisterJson.match(
      /"dimensionToAsinMap"\s*:\s*(\{[^}]+\})/,
    );
    if (dimAsinMatch) {
      try {
        dimToAsin = JSON.parse(dimAsinMatch[1]) as Record<string, string>;
      } catch {
        /* */
      }
    }

    let currentAsin = '';
    const curAsinMatch = twisterJson.match(/"currentAsin"\s*:\s*"([^"]+)"/);
    if (curAsinMatch) currentAsin = curAsinMatch[1];

    // --- build variants with human-readable display labels ---
    const variants: { name: string; options: string[] }[] = dimensions
      .filter((key) => (variationValues[key] ?? []).length > 0)
      .map((key) => ({
        name: displayLabels[key] || this.humaniseDimKey(key),
        options: variationValues[key],
      }));

    // --- build configurationPrices from the dimension→ASIN map ---
    const configurationPrices: ProductConfigurationPrice[] = [];
    for (const [dimKey, asin] of Object.entries(dimToAsin)) {
      const indices = dimKey.split('_').map(Number);
      const variantSelections: Record<string, string> = {};
      const labelParts: string[] = [];

      for (let i = 0; i < dimensions.length; i++) {
        const dim = dimensions[i];
        const displayName = displayLabels[dim] || this.humaniseDimKey(dim);
        const val = variationValues[dim]?.[indices[i]];
        if (val != null) {
          variantSelections[displayName] = val;
          labelParts.push(val);
        }
      }

      const label = labelParts.join(' · ');
      if (!label) continue;

      const isCurrentVariant = asin === currentAsin;
      configurationPrices.push({
        label,
        // Use the scraped price for the current variant; mark others as needing
        // a live price fetch (Amazon doesn't embed per-variant prices in the HTML).
        originalPrice: currentPrice || '0.00',
        sku: asin,
        ...(Object.keys(variantSelections).length ? { variantSelections } : {}),
        available: true,
        metadata: {
          asin,
          source: 'amazon-twister',
          ...(isCurrentVariant ? {} : { priceNeedsLookup: true }),
        },
      });
    }

    return { variants, configurationPrices, currentAsin };
  }

  /** `size_name` → `Size`, `style_name` → `Style`, etc. */
  private humaniseDimKey(key: string): string {
    return key
      .replace(/_name$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Strip Amazon store-link noise from bylineInfo ("Visit the LG Store" → "LG"). */
  private cleanBrand(raw: string): string {
    return raw
      .replace(/^Visit the\s+/i, '')
      .replace(/\s+Store$/i, '')
      .replace(/^Brand:\s*/i, '')
      .trim();
  }

  /** Assemble a structured description from feature bullets, spec table, and rating. */
  private buildDescription(
    raw: AmazonRawData,
    specs: [string, string][],
  ): string {
    const parts: string[] = [];

    if (raw.description) {
      const clean = raw.description.replace(/\s{2,}/g, ' ').trim();
      if (clean) parts.push(clean);
    }

    if (specs.length) {
      const lines = specs.map(([k, v]) => `• ${k}: ${v}`).join('\n');
      parts.push(`Specifications:\n${lines}`);
    }

    const ratingParts: string[] = [];
    if (raw.rating) ratingParts.push(raw.rating);
    if (raw.reviewCount) ratingParts.push(raw.reviewCount);
    if (ratingParts.length) parts.push(`Rating: ${ratingParts.join(' · ')}`);

    if (raw.sellerName) parts.push(`Sold by: ${raw.sellerName}`);

    return parts.join('\n\n');
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
