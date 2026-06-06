import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

// ─── Walmart __NEXT_DATA__ shapes ─────────────────────────────────────────────

interface WalmartPrice {
  price?: number;
  priceString?: string;
  currencyUnit?: string;
  priceDisplay?: string;
}

interface WalmartPriceInfo {
  currentPrice?: WalmartPrice;
  wasPrice?: WalmartPrice | null;
  savingsAmount?: { price?: number; priceString?: string } | null;
  listPrice?: WalmartPrice | null;
}

interface WalmartImage {
  id?: string;
  url?: string;
  zoomable?: boolean;
}

interface WalmartImageInfo {
  allImages?: WalmartImage[] | null;
  thumbnailUrl?: string;
}

interface WalmartVariantOption {
  id: string;
  name: string;
  availabilityStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | string;
  selected: boolean;
  products: string[];
  images?: WalmartImage[] | null;
  swatchImageUrl?: string | null;
}

interface WalmartVariantCriterion {
  id: string;
  name: string;
  type?: string;
  variantList: WalmartVariantOption[];
}

interface WalmartVariantMapEntry {
  id: string;
  availabilityStatus?: string;
  priceInfo?: WalmartPriceInfo;
  imageInfo?: WalmartImageInfo;
  variants?: string[];
  productUrl?: string;
  usItemId?: string;
  shortDescription?: string | null;
}

interface WalmartProduct {
  name?: string;
  brand?: string;
  usItemId?: string;
  primaryProductId?: string;
  offerId?: string;
  selectedOfferId?: string;
  availabilityStatus?: string;
  upc?: string;
  model?: string;
  priceInfo?: WalmartPriceInfo;
  imageInfo?: WalmartImageInfo;
  shortDescription?: string | null;
  variantCriteria?: WalmartVariantCriterion[];
  variantsMap?: Record<string, WalmartVariantMapEntry>;
  variantProductIdMap?: Record<string, string>;
  numberOfReviews?: number | null;
  averageRating?: number | null;
}

interface WalmartIdml {
  shortDescription?: string | null;
  longDescription?: string | null;
  specifications?: Array<{ name?: string; value?: string }> | null;
  productHighlights?: string[] | null;
}

interface WalmartReviews {
  averageOverallRating?: number | null;
  totalReviewCount?: number | null;
}

interface WalmartInitialData {
  product?: WalmartProduct;
  idml?: WalmartIdml;
  reviews?: WalmartReviews;
}

interface WalmartNextData {
  props?: {
    pageProps?: {
      initialData?: {
        data?: WalmartInitialData;
      };
    };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAvailability(status: string | undefined): string {
  if (!status) return 'unknown';
  if (status === 'IN_STOCK') return 'in_stock';
  if (status === 'OUT_OF_STOCK') return 'out_of_stock';
  return 'unknown';
}

/**
 * Build a `variantSelections` map for a variantsMap entry.
 * Each entry carries e.g. ["bed_size-queen", "mattress_thickness-12in"].
 * We reverse-lookup axis name + option name from variantCriteria.
 */
function buildVariantSelections(
  variantIds: string[],
  criteria: WalmartVariantCriterion[],
): Record<string, string> | undefined {
  if (!variantIds.length || !criteria.length) return undefined;
  const sel: Record<string, string> = {};
  for (const vid of variantIds) {
    for (const axis of criteria) {
      const option = axis.variantList.find((v) => v.id === vid);
      if (option) {
        sel[axis.name] = option.name;
        break;
      }
    }
  }
  return Object.keys(sel).length ? sel : undefined;
}

@Injectable()
export class WalmartAdapter implements ScraperAdapter {
  readonly source = ProductSource.WALMART;

  private readonly logger = new Logger(WalmartAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      gotoOptions: { waitUntil: 'load', timeout: 60_000 },
    });

    try {
      // Wait for __NEXT_DATA__ to contain a Walmart product price
      await page
        .waitForFunction(
          () => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el?.textContent) return false;
            try {
              const d = JSON.parse(el.textContent) as Record<string, unknown>;
              const pp = (d?.props as Record<string, unknown>)
                ?.pageProps as Record<string, unknown>;
              const product = (
                (pp?.initialData as Record<string, unknown>)
                  ?.data as Record<string, unknown>
              )?.product as Record<string, unknown>;
              return (
                typeof (
                  (product?.priceInfo as Record<string, unknown>)
                    ?.currentPrice as Record<string, unknown>
                )?.price === 'number'
              );
            } catch {
              return false;
            }
          },
          { timeout: 20_000 },
        )
        .catch(() => undefined);

      const nextDataJson = await page.evaluate(
        () => document.getElementById('__NEXT_DATA__')?.textContent ?? null,
      );

      this.logger.log(
        `[walmart] __NEXT_DATA__ present=${nextDataJson != null} len=${nextDataJson?.length ?? 0}`,
      );

      if (nextDataJson) {
        const parsed = this.parseNextData(nextDataJson);
        if (parsed) return parsed;
        this.logger.warn('[walmart] parseNextData returned null — falling back to generic');
      }
    } catch (err) {
      this.logger.warn(
        `[walmart] scrape error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await context.close();
    }

    return this.generic.scrape(url);
  }

  private parseNextData(json: string): ScrapedProduct | null {
    let root: WalmartNextData;
    try {
      root = JSON.parse(json) as WalmartNextData;
    } catch {
      return null;
    }

    const initData = root?.props?.pageProps?.initialData?.data;
    if (!initData) return null;

    const product = initData.product;
    const idml = initData.idml;
    const reviews = initData.reviews;

    if (!product) return null;

    // ── Title ─────────────────────────────────────────────────────────────────
    const title = product.name?.trim();
    if (!title) return null;

    // ── Price ─────────────────────────────────────────────────────────────────
    const pi = product.priceInfo;
    const rawPrice = pi?.currentPrice?.price ?? 0;
    const currency = pi?.currentPrice?.currencyUnit ?? 'USD';
    const price = parsePriceToDecimalString(rawPrice) ?? rawPrice.toFixed(2);

    // ── Compare-at / discount ─────────────────────────────────────────────────
    const wasRaw = pi?.wasPrice?.price ?? pi?.listPrice?.price ?? null;
    const compareAtPrice = wasRaw != null
      ? (parsePriceToDecimalString(wasRaw) ?? wasRaw.toFixed(2))
      : null;
    const savingsRaw = pi?.savingsAmount?.price ?? null;
    const savingsAmount = savingsRaw != null && savingsRaw > 0
      ? (parsePriceToDecimalString(savingsRaw) ?? savingsRaw.toFixed(2))
      : null;
    const discount =
      compareAtPrice && parseFloat(price) > 0 && parseFloat(compareAtPrice) > parseFloat(price)
        ? `-${Math.round((1 - parseFloat(price) / parseFloat(compareAtPrice)) * 100)}%`
        : null;

    // ── Images ────────────────────────────────────────────────────────────────
    const images: string[] = (product.imageInfo?.allImages ?? [])
      .map((img) => img.url)
      .filter((u): u is string => !!u);

    // ── Description ───────────────────────────────────────────────────────────
    const descHtml =
      idml?.shortDescription ??
      product.shortDescription ??
      idml?.longDescription ??
      null;
    let description: string | undefined = descHtml
      ? stripHtml(descHtml).slice(0, 2000) || undefined
      : undefined;

    // Append product highlights as bullet points
    const highlights = idml?.productHighlights ?? [];
    if (highlights.length) {
      const bullets = highlights.slice(0, 8).join(' · ');
      description = description ? `${description}\n\n${bullets}` : bullets;
    }

    // Append review summary
    if (reviews?.averageOverallRating && reviews?.totalReviewCount) {
      const rev = `Rating: ${reviews.averageOverallRating}/5 (${reviews.totalReviewCount} reviews)`;
      description = description ? `${description}\n\n${rev}` : rev;
    }

    // ── Availability ──────────────────────────────────────────────────────────
    const availability = normalizeAvailability(product.availabilityStatus);

    // ── Variants & configurationPrices ────────────────────────────────────────
    const criteria = product.variantCriteria ?? [];
    const variantsMap = product.variantsMap ?? {};

    // Build variants[] from variantCriteria
    const variants = criteria.map((axis) => ({
      name: axis.name,
      options: axis.variantList.map((v) => v.name),
    }));

    // Build configurationPrices[] from variantsMap entries
    const configurationPrices: ProductConfigurationPrice[] = [];

    for (const [productId, entry] of Object.entries(variantsMap)) {
      const entryPrice = entry.priceInfo?.currentPrice?.price;
      if (entryPrice == null || entryPrice <= 0) continue;

      const entryPriceStr =
        parsePriceToDecimalString(entryPrice) ?? entryPrice.toFixed(2);
      const entryCurrency =
        entry.priceInfo?.currentPrice?.currencyUnit ?? currency;
      const available =
        entry.availabilityStatus == null ||
        entry.availabilityStatus === 'IN_STOCK';

      const variantIds = entry.variants ?? [];
      const variantSelections = buildVariantSelections(variantIds, criteria);

      // Build human-readable label from the resolved selection values
      const labelParts = variantSelections
        ? Object.values(variantSelections)
        : variantIds.map((vid) => vid.split('-').slice(1).join(' '));
      const label = labelParts.join(' · ') || productId;

      // Single-axis convenience fields (when exactly one axis)
      let variantAxis: string | undefined;
      let optionValue: string | undefined;
      if (variantSelections && Object.keys(variantSelections).length === 1) {
        [[variantAxis, optionValue]] = Object.entries(variantSelections);
      }

      configurationPrices.push({
        label,
        originalPrice: entryPriceStr,
        sku: entry.usItemId ?? productId,
        variantAxis,
        optionValue,
        variantSelections,
        currency: entryCurrency !== currency ? entryCurrency : undefined,
        available,
        metadata: {
          source: 'walmart',
          walmartProductId: productId,
          usItemId: entry.usItemId,
        },
      });
    }

    return {
      title,
      price,
      currency,
      images,
      description,
      brand: product.brand?.trim() || undefined,
      asin: product.usItemId ?? undefined,
      compareAtPrice: compareAtPrice ?? undefined,
      savingsAmount: savingsAmount ?? undefined,
      discount: discount ?? undefined,
      availability,
      variants,
      configurationPrices,
      metadata: {
        source: 'walmart',
        upc: product.upc ?? null,
        model: product.model ?? null,
        offerId: product.offerId ?? product.selectedOfferId ?? null,
      },
    };
  }
}
