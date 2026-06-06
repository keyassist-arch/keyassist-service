import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

// ─── Reebelo __NEXT_DATA__ shapes ─────────────────────────────────────────────
// Reebelo stores prices as integer CENTS (e.g. 7548 = $75.48).

interface ReebeloImage {
  url?: string;
}

interface ReebeloVariantValue {
  value: string;
  displayValue?: string | null;
  sequence?: number;
  hexValue?: string | null;
}

interface ReebeloVariantAxis {
  id?: string;
  name: string;
  slug?: string;
}

/** Entry in `product.variants[]` — the full axis with all possible values */
interface ReebeloProductVariantEntry {
  variant: ReebeloVariantAxis;
  values: ReebeloVariantValue[];
  sequence?: number;
}

/** Entry in `selectedSku.variants[]` — the current selection (one value per axis) */
interface ReebeloSkuVariantEntry {
  variant: ReebeloVariantAxis;
  value: ReebeloVariantValue;
}

interface ReebeloOffer {
  id?: string;
  vendorSku?: string;
  skuId?: string;
  store?: string;
  stock?: number;
  price?: number;
  vendor?: { id?: string; name?: string };
  priceComponents?: Array<{ name?: string; price?: number }>;
}

interface ReebeloSku {
  id?: string;
  slug?: string;
  title?: string;
  image?: ReebeloImage;
  images?: ReebeloImage[];
  variants?: ReebeloSkuVariantEntry[];
  offers?: ReebeloOffer[];
  product?: { id?: string; name?: string };
}

interface ReebeloProduct {
  id?: string;
  name?: string;
  title?: string;
  slug?: string;
  description?: string;
  psku?: string;
  brand?: { id?: string; name?: string };
  category?: { id?: string; name?: string; slug?: string };
  image?: ReebeloImage;
  images?: ReebeloImage[];
  variants?: ReebeloProductVariantEntry[];
  specifications?: unknown[];
  features?: unknown[];
}

/** Entry in `availableVariants[]` — each in-stock SKU with price + full variant selection */
interface ReebeloAvailableVariant {
  price?: number;
  skuId?: string;
  offerId?: string;
  featured?: boolean;
  variants?: Array<{
    variant: ReebeloVariantAxis;
    value: ReebeloVariantValue;
  }>;
}

interface ReebeloPageProps {
  productId?: string;
  skuId?: string;
  product?: ReebeloProduct;
  selectedSku?: ReebeloSku;
  availableVariants?: ReebeloAvailableVariant[];
  additionalInfo?: {
    conditions?: Array<{ name?: string; description?: string }>;
    categoryWarrantyInfo?: { warrantyLength?: number; warrantyUnit?: string; eligible?: boolean };
  };
}

interface ReebeloNextData {
  props?: {
    pageProps?: ReebeloPageProps;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reebelo stores prices as integer cents — convert to decimal dollar string. */
function centsToPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Prefer displayValue when meaningful; fall back to raw value. */
function resolveDisplayValue(v: ReebeloVariantValue): string {
  return (v.displayValue?.trim() || v.value?.trim()) ?? '';
}

@Injectable()
export class ReebeloAdapter implements ScraperAdapter {
  readonly source = ProductSource.REEBELO;

  private readonly logger = new Logger(ReebeloAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      gotoOptions: { waitUntil: 'load', timeout: 60_000 },
    });

    try {
      // Wait until __NEXT_DATA__ contains at least the product name
      await page
        .waitForFunction(
          () => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el?.textContent) return false;
            try {
              const d = JSON.parse(el.textContent) as Record<string, unknown>;
              const pp = (d?.props as Record<string, unknown>)
                ?.pageProps as Record<string, unknown>;
              const product = pp?.product as Record<string, unknown>;
              return typeof product?.name === 'string' && product.name.length > 0;
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
        `[reebelo] __NEXT_DATA__ present=${nextDataJson != null} len=${nextDataJson?.length ?? 0}`,
      );

      if (nextDataJson) {
        const parsed = this.parseNextData(nextDataJson);
        if (parsed) return parsed;
        this.logger.warn('[reebelo] parseNextData returned null — falling back to generic');
      }
    } catch (err) {
      this.logger.warn(
        `[reebelo] scrape error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await context.close();
    }

    return this.generic.scrape(url);
  }

  private parseNextData(json: string): ScrapedProduct | null {
    let root: ReebeloNextData;
    try {
      root = JSON.parse(json) as ReebeloNextData;
    } catch {
      return null;
    }

    const pp = root?.props?.pageProps;
    if (!pp) return null;

    const product = pp.product;
    const selectedSku = pp.selectedSku;
    const availableVariants = pp.availableVariants ?? [];

    if (!product?.name) return null;

    // ── Title ─────────────────────────────────────────────────────────────────
    const title = (product.title ?? product.name).trim();

    // ── Price (cents → dollars) ───────────────────────────────────────────────
    // Prefer the selected SKU's offer price; fall back to cheapest available variant.
    const selectedOfferPrice = selectedSku?.offers?.[0]?.price;
    const cheapestAvailable = availableVariants.reduce<number | null>((min, av) => {
      if (av.price == null) return min;
      return min == null || av.price < min ? av.price : min;
    }, null);
    const rawPriceCents = selectedOfferPrice ?? cheapestAvailable ?? 0;
    const price = parsePriceToDecimalString(centsToPrice(rawPriceCents)) ?? centsToPrice(rawPriceCents);
    const currency = 'USD';

    // ── Images ────────────────────────────────────────────────────────────────
    const imageSource = selectedSku?.images?.length ? selectedSku.images : product.images ?? [];
    const images: string[] = imageSource.map((img) => img.url).filter((u): u is string => !!u);
    // Ensure product main image is included if not already present
    if (product.image?.url && !images.includes(product.image.url)) {
      images.unshift(product.image.url);
    }

    // ── Description ───────────────────────────────────────────────────────────
    let description = product.description?.trim() ?? '';

    // Append condition info from additionalInfo
    const conditions = pp.additionalInfo?.conditions ?? [];
    if (conditions.length) {
      const condBlock = conditions
        .map((c) => `${c.name}: ${c.description}`)
        .join('\n');
      description = description ? `${description}\n\nCondition Guide:\n${condBlock}` : condBlock;
    }

    // Append warranty if present
    const warranty = pp.additionalInfo?.categoryWarrantyInfo;
    if (warranty?.eligible && warranty.warrantyLength) {
      description += `\n\nWarranty: ${warranty.warrantyLength} ${warranty.warrantyUnit ?? 'month'}(s)`;
    }

    // ── Availability ──────────────────────────────────────────────────────────
    const selectedStock = selectedSku?.offers?.[0]?.stock ?? 0;
    const availability = selectedStock > 0 ? 'in_stock' : 'out_of_stock';

    // ── Variants (axes from product.variants, enriched with availableVariants) ─
    // Build the set of unique values per axis that actually appear in availableVariants
    const axisValuesInStock = new Map<string, Set<string>>();
    for (const av of availableVariants) {
      for (const sv of av.variants ?? []) {
        const axisName = sv.variant?.name;
        if (!axisName) continue;
        if (!axisValuesInStock.has(axisName)) axisValuesInStock.set(axisName, new Set());
        axisValuesInStock.get(axisName)!.add(resolveDisplayValue(sv.value));
      }
    }

    const variants = (product.variants ?? [])
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((entry) => ({
        name: entry.variant.name,
        options: entry.values
          .slice()
          .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          .map((v) => resolveDisplayValue(v))
          .filter(Boolean),
      }))
      .filter((v) => v.options.length > 0);

    // ── configurationPrices (one row per availableVariant) ────────────────────
    const configurationPrices: ProductConfigurationPrice[] = [];

    for (const av of availableVariants) {
      if (av.price == null) continue;
      const avPrice = centsToPrice(av.price);
      const avPriceStr = parsePriceToDecimalString(avPrice) ?? avPrice;

      // Build variantSelections map: axisName → display value
      const variantSelections: Record<string, string> = {};
      for (const sv of av.variants ?? []) {
        const axisName = sv.variant?.name;
        if (axisName) variantSelections[axisName] = resolveDisplayValue(sv.value);
      }

      // Human label: all selection values joined
      const labelParts = Object.values(variantSelections).filter(Boolean);
      const label = labelParts.join(' · ') || (av.skuId ?? 'Default');

      // Single-axis shorthand fields
      let variantAxis: string | undefined;
      let optionValue: string | undefined;
      const axisEntries = Object.entries(variantSelections);
      if (axisEntries.length === 1) {
        [[variantAxis, optionValue]] = axisEntries;
      }

      configurationPrices.push({
        label,
        originalPrice: avPriceStr,
        sku: av.skuId,
        variantAxis,
        optionValue,
        variantSelections: Object.keys(variantSelections).length ? variantSelections : undefined,
        currency: undefined,
        available: true,
        metadata: {
          source: 'reebelo',
          skuId: av.skuId,
          offerId: av.offerId,
          featured: av.featured ?? false,
        },
      });
    }

    // ── asin: use Reebelo's skuId as the marketplace identifier ───────────────
    const asin = pp.skuId ?? selectedSku?.id ?? undefined;

    // ── Vendor / seller metadata ───────────────────────────────────────────────
    const vendor = selectedSku?.offers?.[0]?.vendor?.name ?? null;
    const buyerProtectionFee = selectedSku?.offers?.[0]?.priceComponents
      ?.find((c) => c.name === 'buyer_protection_fee')?.price ?? null;

    return {
      title,
      price,
      currency,
      images,
      description: description || undefined,
      brand: product.brand?.name?.trim() || undefined,
      asin,
      availability,
      variants,
      configurationPrices,
      metadata: {
        source: 'reebelo',
        productId: pp.productId ?? product.id ?? null,
        psku: product.psku ?? null,
        category: product.category?.name ?? null,
        vendor,
        buyerProtectionFeeCents: buyerProtectionFee,
        store: selectedSku?.offers?.[0]?.store ?? null,
      },
    };
  }
}
