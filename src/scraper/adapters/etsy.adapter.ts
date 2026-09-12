import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';

// ─── Etsy page architecture notes ─────────────────────────────────────────────
//
// Etsy is NOT a Next.js app — there is no __NEXT_DATA__.
// Product data lives in three places (priority order):
//
//   1. JSON-LD <script type="application/ld+json"> — Product node.
//      Contains: title, description, price, currency, images (ImageObject[]),
//      brand (shop name), sku (listing ID), material, category, aggregateRating,
//      availability, free-shipping flag, offer.shippingDetails.
//
//   2. Etsy.Context.data — inline JS object assigned via
//      `Etsy.Context.data = assign(Etsy.Context.data || {}, {...})`.
//      Contains: listingId, listing_price (float), shopId, shop_name.
//      Used as cross-check / fallback for price.
//
//   3. DOM — live elements rendered by Playwright.
//      - [data-buy-box-region="price"] → current price text.
//      - .wt-text-strikethrough (or .ux-textspans--STRIKETHROUGH) → list/was price.
//      - data-src-zoom-image attributes on carousel items → full-size images.
//      - "Only N available" text → scarcity label.
//      - data-selector="listing-page-variations" container → variation selects
//        (rendered client-side by React; present only after hydration).
//
// Variations:
//   Etsy variations are rendered entirely client-side. After hydration,
//   Playwright reads <select> elements. Etsy sometimes encodes per-option
//   price deltas in option text: "Red (+$5.00)".

// ─── Types ────────────────────────────────────────────────────────────────────

interface EtsyLdOffer {
  '@type'?: string;
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
  priceSpecification?: {
    price?: string | number;
    priceCurrency?: string;
    name?: string;
  };
  shippingDetails?:
    | { shippingRate?: { value?: string | number; currency?: string } }
    | Array<{ shippingRate?: { value?: string | number } }>;
}

interface EtsyLdImage {
  '@type'?: string;
  contentURL?: string;
  url?: string;
}

interface EtsyLdProduct {
  '@type'?: string;
  name?: string;
  description?: string;
  sku?: string;
  gtin?: string;
  material?: string;
  category?: string;
  brand?: { name?: string } | string;
  image?: string | EtsyLdImage | Array<string | EtsyLdImage>;
  offers?: EtsyLdOffer | EtsyLdOffer[];
  aggregateRating?: { ratingValue?: string | number; reviewCount?: number };
  url?: string;
}

interface EtsyVariationOption {
  label: string;
  priceModifier?: number;
}

interface EtsyVariation {
  name: string;
  options: EtsyVariationOption[];
}

interface EtsyRawBundle {
  ldProductJson: string | null;
  titleFallback: string | null;
  domPrice: string | null;
  domListPrice: string | null;
  carouselImages: string[];
  scarcityText: string | null;
  variations: EtsyVariation[];
  contextPrice: number | null;
  shopName: string | null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function ldImageUrl(img: string | EtsyLdImage): string {
  if (typeof img === 'string') return img;
  return img.contentURL ?? img.url ?? '';
}

function resolveOffer(ld: EtsyLdProduct): EtsyLdOffer | null {
  if (!ld.offers) return null;
  return Array.isArray(ld.offers) ? (ld.offers[0] ?? null) : ld.offers;
}

function brandName(ld: EtsyLdProduct): string | undefined {
  const b = ld.brand;
  if (!b) return undefined;
  if (typeof b === 'string') return b;
  return b.name;
}

function normaliseAvailability(
  availUrl: string | undefined,
): 'in_stock' | 'out_of_stock' {
  if (!availUrl) return 'in_stock';
  const lower = availUrl.toLowerCase();
  if (lower.includes('outofstock') || lower.includes('discontinued')) {
    return 'out_of_stock';
  }
  return 'in_stock';
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

@Injectable()
export class EtsyAdapter implements ScraperAdapter {
  readonly source = ProductSource.ETSY;
  private readonly logger = new Logger(EtsyAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      contextOverrides: {
        locale: 'en-US',
      },
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 60_000 },
    });

    try {
      await page
        .waitForSelector(
          '[data-buy-box-region="price"], script[type="application/ld+json"]',
          { timeout: 20_000 },
        )
        .catch(() => undefined);

      // Short pause for React hydration so variation <select>s render.
      await new Promise((r) => setTimeout(r, 1_500));

      const bundle = await page.evaluate((): EtsyRawBundle => {
        // ── ld+json ──────────────────────────────────────────────────────
        let ldProductJson: string | null = null;
        for (const s of Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        )) {
          const raw = s.textContent?.trim() ?? '';
          try {
            const parsed = JSON.parse(raw) as unknown;
            const nodes = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of nodes) {
              if (
                node &&
                typeof node === 'object' &&
                (node as Record<string, unknown>)['@type'] === 'Product'
              ) {
                ldProductJson = raw;
                break;
              }
            }
          } catch {
            /* skip */
          }
          if (ldProductJson) break;
        }

        // ── Title fallback ───────────────────────────────────────────────
        const titleFallback =
          (
            document.querySelector(
              '[data-buy-box-listing-title]',
            ) as HTMLElement | null
          )?.textContent?.trim() ||
          (
            document.querySelector(
              'meta[property="og:title"]',
            ) as HTMLMetaElement | null
          )?.content?.trim() ||
          document.querySelector('h1')?.textContent?.trim() ||
          null;

        // ── Buy-box DOM price ────────────────────────────────────────────
        const priceEl = document.querySelector(
          '[data-buy-box-region="price"] .wt-text-title-larger',
        );
        const domPrice = priceEl?.textContent?.trim() ?? null;

        // ── Strikethrough (list/was) price ───────────────────────────────
        const strikeEl = document.querySelector(
          '.wt-text-strikethrough .currency-value, .ux-textspans--STRIKETHROUGH',
        );
        const domListPrice = strikeEl
          ? (() => {
              const parent = strikeEl.closest('p, span') ?? strikeEl;
              return parent.textContent?.replace(/\s+/g, ' ').trim() ?? null;
            })()
          : null;

        // ── Carousel images (full-size zoom URLs) ────────────────────────
        const carouselImages: string[] = [];
        const seen = new Set<string>();
        for (const el of Array.from(
          document.querySelectorAll('[data-src-zoom-image]'),
        )) {
          const u = el.getAttribute('data-src-zoom-image') ?? '';
          if (u && !seen.has(u)) {
            seen.add(u);
            carouselImages.push(u);
          }
        }

        // ── Scarcity text ────────────────────────────────────────────────
        let scarcityText: string | null = null;
        const bodyText = document.body.innerText;
        const scarcityMatch = bodyText.match(
          /Only\s+\d+\s+(?:left|available)[^.!]*/i,
        );
        if (scarcityMatch) scarcityText = scarcityMatch[0].trim();

        // ── Variations (hydrated client-side) ────────────────────────────
        const variations: EtsyRawBundle['variations'] = [];
        const varContainer = document.querySelector(
          '[data-selector="listing-page-variations"]',
        );
        if (varContainer) {
          for (const select of Array.from(
            varContainer.querySelectorAll('select'),
          )) {
            const labelEl =
              select.closest('div')?.querySelector('label') ??
              document.querySelector(`label[for="${select.id}"]`);
            const varName =
              labelEl?.textContent?.replace(/\*/g, '').trim() ||
              select.getAttribute('aria-label') ||
              select.name ||
              'Option';

            const options: EtsyVariationOption[] = [];
            for (const opt of Array.from(select.options)) {
              const label = opt.text.trim();
              if (!label || label.toLowerCase().startsWith('select')) continue;
              const deltaMatch = label.match(/\(\s*[+\-]?\s*\$?([\d.]+)\s*\)/);
              options.push({
                label: label.replace(/\s*\([^)]*\)\s*$/, '').trim(),
                priceModifier: deltaMatch
                  ? parseFloat(deltaMatch[1])
                  : undefined,
              });
            }
            if (options.length) {
              variations.push({ name: varName, options });
            }
          }
        }

        // ── Etsy.Context.data price (server-authoritative) ────────────────
        let contextPrice: number | null = null;
        let shopName: string | null = null;
        try {
          const ctx = (
            window as unknown as {
              Etsy?: { Context?: { data?: Record<string, unknown> } };
            }
          )?.Etsy?.Context?.data;
          if (ctx) {
            const lp = ctx['listing_price'];
            if (typeof lp === 'number' && lp > 0) contextPrice = lp;
            const sn = ctx['shop_name'];
            if (typeof sn === 'string' && sn) shopName = sn;
          }
        } catch {
          /* Etsy not on window */
        }

        return {
          ldProductJson,
          titleFallback,
          domPrice,
          domListPrice,
          carouselImages,
          scarcityText,
          variations,
          contextPrice,
          shopName,
        };
      });

      return await this.buildProduct(bundle, url);
    } catch (err) {
      this.logger.error(
        `EtsyAdapter: scrape failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.generic.scrape(url);
    } finally {
      await context.close();
    }
  }

  private async buildProduct(
    bundle: EtsyRawBundle,
    url: string,
  ): Promise<ScrapedProduct> {
    // ── Parse ld+json ───────────────────────────────────────────────────────
    let ld: EtsyLdProduct | null = null;
    if (bundle.ldProductJson) {
      try {
        const parsed = JSON.parse(bundle.ldProductJson) as unknown;
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        ld =
          (nodes.find(
            (n) =>
              n &&
              typeof n === 'object' &&
              (n as EtsyLdProduct)['@type'] === 'Product',
          ) as EtsyLdProduct | undefined) ?? null;
      } catch {
        /* fallback below */
      }
    }

    // ── Title ───────────────────────────────────────────────────────────────
    const rawTitle = ld?.name || bundle.titleFallback || '';
    const title = rawTitle
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    if (!title) {
      this.logger.warn(`EtsyAdapter: no title at ${url} — falling back`);
      return this.generic.scrape(url);
    }

    // ── Price ───────────────────────────────────────────────────────────────
    const offer = ld ? resolveOffer(ld) : null;

    const ldPriceRaw = offer?.price != null ? String(offer.price) : null;
    const contextPriceStr =
      bundle.contextPrice != null ? bundle.contextPrice.toFixed(2) : null;

    const priceStr =
      (ldPriceRaw ? parsePriceToDecimalString(ldPriceRaw) : null) ??
      contextPriceStr ??
      (bundle.domPrice ? parsePriceToDecimalString(bundle.domPrice) : null);

    if (!priceStr) {
      this.logger.warn(`EtsyAdapter: no price at ${url} — falling back`);
      return this.generic.scrape(url);
    }

    // ── Currency ────────────────────────────────────────────────────────────
    const currency = (offer?.priceCurrency ?? 'USD').toUpperCase().slice(0, 8);

    // ── List/was price (priceSpecification or DOM strikethrough) ────────────
    const ps = offer?.priceSpecification;
    let compareAtPrice: string | undefined;
    if (ps && typeof ps === 'object' && !Array.isArray(ps)) {
      const psPrice = ps.price != null ? String(ps.price) : null;
      const psName = String(ps.name ?? '').toLowerCase();
      if (
        psPrice &&
        (psName.includes('original') ||
          psName.includes('list') ||
          psName.includes('was'))
      ) {
        const parsed = parsePriceToDecimalString(psPrice);
        if (parsed && parseFloat(parsed) > parseFloat(priceStr)) {
          compareAtPrice = parsed;
        }
      }
    }
    if (!compareAtPrice && bundle.domListPrice) {
      const parsed = parsePriceToDecimalString(bundle.domListPrice);
      if (parsed && parseFloat(parsed) > parseFloat(priceStr)) {
        compareAtPrice = parsed;
      }
    }

    const discount = compareAtPrice
      ? `${Math.round((1 - parseFloat(priceStr) / parseFloat(compareAtPrice)) * 100)}% off`
      : undefined;

    const savingsAmount =
      compareAtPrice
        ? (parseFloat(compareAtPrice) - parseFloat(priceStr)).toFixed(2)
        : undefined;

    // ── Availability ────────────────────────────────────────────────────────
    const availability = normaliseAvailability(offer?.availability);

    // ── Free shipping ───────────────────────────────────────────────────────
    let freeShipping = false;
    const shippingDetails = offer?.shippingDetails;
    if (shippingDetails) {
      const first = Array.isArray(shippingDetails)
        ? shippingDetails[0]
        : shippingDetails;
      const rateVal = first?.shippingRate?.value;
      if (
        rateVal != null &&
        (rateVal === '0' || rateVal === 0 || rateVal === '0.00')
      ) {
        freeShipping = true;
      }
    }

    // ── Images ──────────────────────────────────────────────────────────────
    const seen = new Set<string>();
    const images: string[] = [];
    const addImage = (u: string) => {
      const clean = u.trim();
      if (clean && /^https?:\/\//i.test(clean) && !seen.has(clean)) {
        seen.add(clean);
        images.push(clean);
      }
    };

    for (const u of bundle.carouselImages) addImage(u);
    if (ld?.image) {
      const imgs = Array.isArray(ld.image) ? ld.image : [ld.image];
      for (const img of imgs) addImage(ldImageUrl(img));
    }

    // ── Brand / shop ────────────────────────────────────────────────────────
    const brand = brandName(ld ?? {}) || bundle.shopName || undefined;

    // ── Description ─────────────────────────────────────────────────────────
    const descParts: string[] = [];
    if (ld?.description) descParts.push(ld.description.trim());
    if (ld?.material) descParts.push(`Material: ${ld.material}`);
    if (ld?.category) {
      const cat = ld.category.replace(/\s*<\s*/g, ' › ');
      descParts.push(`Category: ${cat}`);
    }
    if (freeShipping) descParts.push('Free shipping included.');
    if (bundle.scarcityText) descParts.push(bundle.scarcityText);

    const rating = ld?.aggregateRating;
    if (rating) {
      const rv = rating.ratingValue ?? '';
      const rc = rating.reviewCount ?? '';
      if (rv || rc) {
        descParts.push(
          `Rating: ${rv}${rv && rc ? ' · ' : ''}${rc ? `${rc} reviews` : ''}`,
        );
      }
    }

    // ── Variants ────────────────────────────────────────────────────────────
    const variants: ScrapedProduct['variants'] = bundle.variations.map((v) => ({
      name: v.name,
      options: v.options.map((o) => o.label),
    }));

    const configurationPrices: ProductConfigurationPrice[] = [];
    for (const variation of bundle.variations) {
      const hasDeltas = variation.options.some(
        (o) => o.priceModifier != null && o.priceModifier !== 0,
      );
      if (!hasDeltas) continue;

      for (const opt of variation.options) {
        const delta = opt.priceModifier ?? 0;
        const optPrice = (parseFloat(priceStr) + delta).toFixed(2);
        configurationPrices.push({
          label: `${variation.name}: ${opt.label}`,
          originalPrice: optPrice,
          variantAxis: variation.name,
          optionValue: opt.label,
          available: true,
          metadata: { source: 'etsy-variation', priceModifier: delta },
        });
      }
    }

    const listingId = ld?.sku ?? undefined;

    this.logger.log(
      `EtsyAdapter: url=${url} title="${title}" price=${priceStr} ` +
        `currency=${currency} images=${images.length} variants=${variants.length} ` +
        `freeShipping=${freeShipping}`,
    );

    return {
      title,
      price: priceStr,
      currency,
      compareAtPrice,
      discount,
      savingsAmount,
      images: images.slice(0, 20),
      brand,
      description: descParts.join('\n\n') || undefined,
      sku: listingId,
      ...(rating?.ratingValue != null
        ? {
            rating: {
              value: rating.ratingValue,
              reviewCount:
                rating.reviewCount != null ? Number(rating.reviewCount) : undefined,
            },
          }
        : {}),
      variants,
      ...(configurationPrices.length ? { configurationPrices } : {}),
      availability,
      metadata: {
        source: 'etsy',
        listingId,
        shopName: brand,
        freeShipping,
        scarcity: bundle.scarcityText ?? undefined,
      },
    };
  }
}
