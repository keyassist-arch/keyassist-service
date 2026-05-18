import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';

interface NikeImageProps {
  squarish?: { url: string };
  portrait?: { url: string };
  landscape?: { url: string };
}

interface NikeContentImage {
  properties?: NikeImageProps;
}

interface NikeSize {
  label: string;
  localizedLabel?: string;
  status?: string;
  /** Correct field name on current Nike pages (was incorrectly `skuId`). */
  merchSkuId?: string;
  gtins?: { gtin: string }[];
  sortSequence?: number;
}

interface NikeSizeFitSection {
  sectionType?: string;  // "WIDTH", "FIT", etc.
  label?: string;        // "Regular", "Wide", "Slim", etc.
  sizes?: NikeSize[];
}

interface NikeProductGroup {
  groupLabel: string;
  groupIndex: number;
  products: Record<string, NikeSelectedProduct>;
}

interface NikeColorway {
  colorDescription?: string;
  styleColor?: string;
  contentImages?: NikeContentImage[];
}

interface NikePrices {
  currency?: string;
  currentPrice?: number;
  fullPrice?: number;
  initialPrice?: number;        // was-price when discounted
  discountPercentage?: number;  // 0–100
  employeePrice?: number;
}

interface NikeProductInfo {
  title?: string;
  subtitle?: string;
  fullTitle?: string;
  productDescription?: string;
  featuresAndBenefits?: string[];
  sizeFitSections?: NikeSizeFitSection[];
}

interface NikeSelectedProduct {
  id?: string;
  contentImages?: NikeContentImage[];
  prices?: NikePrices;
  sizes?: NikeSize[];
  colorDescription?: string;
  styleColor?: string;
  statusModifier?: string;
  fitRecommendationMessage?: string;
  productInfo?: NikeProductInfo;
}

interface NikeRawData {
  nextDataJson: string | null;
  ogImage: string | null;
  titleFallback: string | null;
  priceFallback: string | null;
}

@Injectable()
export class NikeAdapter implements ScraperAdapter {
  readonly source = ProductSource.NIKE;
  private readonly logger = new Logger(NikeAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      gotoOptions: { waitUntil: 'load', timeout: 60_000 },
    });
    try {

      // Wait until __NEXT_DATA__ has price data — check both the current path
      // (pageProps.selectedProduct) and the legacy path (pageProps.initialState.selectedProduct).
      await page
        .waitForFunction(
          () => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el?.textContent) return false;
            try {
              const d = JSON.parse(el.textContent) as Record<string, unknown>;
              const pp = (d?.props as Record<string, unknown>)
                ?.pageProps as Record<string, unknown>;
              // Current Nike pages — selectedProduct at pageProps level
              const sel1 = pp?.selectedProduct as Record<string, unknown>;
              if (typeof (sel1?.prices as Record<string, unknown>)?.currentPrice === 'number') return true;
              // Legacy path
              const state = pp?.initialState as Record<string, unknown>;
              const sel2 = state?.selectedProduct as Record<string, unknown>;
              return typeof (sel2?.prices as Record<string, unknown>)?.currentPrice === 'number';
            } catch {
              return false;
            }
          },
          { timeout: 20_000 },
        )
        .catch(() => undefined);

      const raw = await page.evaluate((): NikeRawData => {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        return {
          nextDataJson: nextDataEl?.textContent ?? null,
           ogImage:
             (
               document.querySelector(
                 'meta[property="og:image"]',
               ) as HTMLMetaElement | null
             )?.content ?? null,
          titleFallback:
            document
              .querySelector('[data-testid="product_title"]')
              ?.textContent?.trim() ??
            document.querySelector('h1')?.textContent?.trim() ??
            null,
          priceFallback:
            document.querySelector('[data-testid="currentPrice-container"]')
              ?.textContent ??
            document.querySelector('[data-test="product-price"]')
              ?.textContent ??
            null,
        };
      });

      this.logger.log(
        `[nike] __NEXT_DATA__ present=${raw.nextDataJson != null} len=${raw.nextDataJson?.length ?? 0} ogImage=${!!raw.ogImage} titleFallback=${!!raw.titleFallback}`,
      );

      const parsed = this.parseNextData(raw);
      if (parsed) return parsed;

      this.logger.warn(
        '[nike] __NEXT_DATA__ parse failed — falling through to generic',
      );
      if (raw.nextDataJson) {
        this.logger.warn(
          `[nike] __NEXT_DATA__ snippet: ${raw.nextDataJson.slice(0, 300)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[nike] scrape error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await context.close();
    }
    return this.generic.scrape(url);
  }

  private parseNextData(raw: NikeRawData): ScrapedProduct | null {
    if (!raw.nextDataJson) return null;

    let root: Record<string, unknown>;
    try {
      root = JSON.parse(raw.nextDataJson) as Record<string, unknown>;
    } catch {
      return null;
    }

    const selected = this.findSelectedProduct(root);
    if (!selected) {
      this.logger.warn('[nike] selectedProduct not found in __NEXT_DATA__');
      return null;
    }

    // ── Price ──────────────────────────────────────────────────────────────
    const prices = selected.prices;
    const currency = prices?.currency ?? 'USD';
    const currentPrice = prices?.currentPrice;
    if (!currentPrice) return null;
    const priceStr = currentPrice.toFixed(2);

    // Discount: initialPrice is the was-price when discountPercentage > 0
    const initialPrice = prices?.initialPrice;
    const compareAtPrice =
      initialPrice && initialPrice > currentPrice
        ? initialPrice.toFixed(2)
        : undefined;
    const discount = prices?.discountPercentage
      ? `${prices.discountPercentage}% off`
      : undefined;

    // ── Title ──────────────────────────────────────────────────────────────
    const info = selected.productInfo;
    const title =
      info?.fullTitle || info?.title || raw.titleFallback || 'Nike Product';

    // ── Images ─────────────────────────────────────────────────────────────
    const colorwayImages = this.getColorwayImages(root);
    const images = this.extractImages(
      selected.contentImages,
      colorwayImages,
      raw.ogImage,
    );

    // ── Description ────────────────────────────────────────────────────────
    const descParts: string[] = [];
    if (info?.productDescription?.trim()) {
      descParts.push(info.productDescription.trim());
    }
    if (info?.featuresAndBenefits?.length) {
      descParts.push(info.featuresAndBenefits.join('\n'));
    }
    if (selected.fitRecommendationMessage?.trim()) {
      descParts.push(`Fit: ${selected.fitRecommendationMessage.trim()}`);
    }
    const description = descParts.join('\n\n') || undefined;

    // ── Groups (Baby/Toddler | Little Kids | Big Kids / Men's | Women's) ───
    const groups = this.extractProductGroups(root);
    const { groupVariant, groupConfigPrices } = this.buildGroupVariants(
      groups,
      selected.styleColor ?? '',
    );

    // ── Width/Fit sections (Regular, Wide — adult products) ─────────────────
    const sizeFitSections = info?.sizeFitSections ?? [];
    const { fitVariant, fitConfigPrices, allSizes: fitSectionSizes } =
      this.buildFitSectionVariants(sizeFitSections, priceStr, currency);

    // ── Sizes (flat — when no sizeFitSections) ─────────────────────────────
    const flatSizes =
      sizeFitSections.length === 0 ? (selected.sizes ?? []) : fitSectionSizes;
    const sizeOptions = flatSizes.map((s) => s.label).filter(Boolean);

    // ── configurationPrices ────────────────────────────────────────────────
    let configurationPrices: ProductConfigurationPrice[];

    if (groupConfigPrices.length > 0) {
      // Multi-group product: group-level prices + per-size within selected group
      const selectedSizeConfigs: ProductConfigurationPrice[] = flatSizes.map(
        (s) => ({
          label: s.label,
          originalPrice: priceStr,
          sku: s.merchSkuId,
          variantAxis: 'Size',
          optionValue: s.label,
          variantSelections: { Size: s.label },
          available: s.status === 'ACTIVE',
          currency,
          metadata: { source: 'nike-size', gtin: s.gtins?.[0]?.gtin },
        }),
      );
      configurationPrices = [...groupConfigPrices, ...selectedSizeConfigs];
    } else if (fitConfigPrices.length > 0) {
      configurationPrices = fitConfigPrices;
    } else {
      configurationPrices = flatSizes.map((s) => ({
        label: s.label,
        originalPrice: priceStr,
        sku: s.merchSkuId,
        variantAxis: 'Size',
        optionValue: s.label,
        variantSelections: { Size: s.label },
        available: s.status === 'ACTIVE',
        currency,
        metadata: { source: 'nike-size', gtin: s.gtins?.[0]?.gtin },
      }));
    }

    // ── Variants (axes for UI selectors) ───────────────────────────────────
    const variants: { name: string; options: string[] }[] = [];
    if (groupVariant) variants.push(groupVariant);
    if (fitVariant) variants.push(fitVariant);
    if (sizeOptions.length) variants.push({ name: 'Size', options: sizeOptions });
    if (selected.colorDescription) {
      variants.push({ name: 'Color', options: [selected.colorDescription] });
    }

    // ── Availability ───────────────────────────────────────────────────────
    const statusMod = selected.statusModifier ?? '';
    const availability = statusMod.includes('BUYABLE')
      ? 'In Stock'
      : 'Out of Stock';

    return {
      title,
      price: priceStr,
      currency,
      compareAtPrice,
      discount,
      images,
      description,
      brand: 'Nike',
      asin: selected.styleColor,
      variants,
      configurationPrices: configurationPrices.length
        ? configurationPrices
        : undefined,
      availability,
    };
  }

  private extractProductGroups(root: Record<string, unknown>): NikeProductGroup[] {
    const raw = (root?.props as Record<string, unknown>)
      ?.pageProps as Record<string, unknown>;
    const groups = raw?.productGroups;
    if (!Array.isArray(groups)) return [];
    return groups as NikeProductGroup[];
  }

  private buildGroupVariants(
    groups: NikeProductGroup[],
    selectedStyleColor: string,
  ): {
    groupVariant: { name: string; options: string[] } | null;
    groupConfigPrices: ProductConfigurationPrice[];
  } {
    if (groups.length <= 1) return { groupVariant: null, groupConfigPrices: [] };

    const options: string[] = [];
    const groupConfigPrices: ProductConfigurationPrice[] = [];

    for (const group of groups) {
      const label = group.groupLabel;
      options.push(label);

      // products is a dict keyed by styleColor — grab the first entry per group
      const prods = Object.values(group.products ?? {});
      if (!prods.length) continue;

      const prod = prods[0];
      const price = prod.prices?.currentPrice;
      const styleColor = prod.styleColor ?? '';

      if (price == null) continue;

      groupConfigPrices.push({
        label,
        originalPrice: price.toFixed(2),
        sku: styleColor,
        variantAxis: 'Fit',
        optionValue: label,
        variantSelections: { Fit: label },
        available: true,
        currency: prod.prices?.currency ?? 'USD',
        metadata: {
          source: 'nike-group',
          styleColor,
          pdpUrl: `https://www.nike.com/t/${styleColor}`,
          isSelectedGroup: styleColor === selectedStyleColor,
        },
      });
    }

    return {
      groupVariant: options.length > 1 ? { name: 'Fit', options } : null,
      groupConfigPrices,
    };
  }

  private buildFitSectionVariants(
    sizeFitSections: NikeSizeFitSection[],
    basePriceStr: string,
    currency: string,
  ): {
    fitVariant: { name: string; options: string[] } | null;
    fitConfigPrices: ProductConfigurationPrice[];
    allSizes: NikeSize[];
  } {
    if (!sizeFitSections?.length) {
      return { fitVariant: null, fitConfigPrices: [], allSizes: [] };
    }

    const options = sizeFitSections
      .map((s) => s.label ?? '')
      .filter(Boolean);
    const fitConfigPrices: ProductConfigurationPrice[] = [];
    const allSizes: NikeSize[] = [];

    for (const section of sizeFitSections) {
      const fitLabel = section.label ?? section.sectionType ?? 'Standard';
      const sizes = section.sizes ?? [];
      allSizes.push(...sizes);

      for (const sz of sizes) {
        fitConfigPrices.push({
          label: `${fitLabel} / ${sz.label}`,
          originalPrice: basePriceStr,
          sku: sz.merchSkuId,
          variantAxis: 'Size',
          optionValue: sz.label,
          variantSelections: { Width: fitLabel, Size: sz.label },
          available: sz.status === 'ACTIVE',
          currency,
          metadata: {
            source: 'nike-fit-section',
            gtin: sz.gtins?.[0]?.gtin,
            fitType: section.sectionType,
          },
        });
      }
    }

    return {
      fitVariant: options.length > 1 ? { name: 'Width', options } : null,
      fitConfigPrices,
      allSizes,
    };
  }

  /**
   * Recursively searches the entire __NEXT_DATA__ tree for any object that looks
   * like a Nike selectedProduct. This handles any app version / path variation.
   */
  private findSelectedProduct(
    root: Record<string, unknown>,
  ): NikeSelectedProduct | null {
    const get = (obj: unknown, ...keys: string[]): unknown => {
      let cur = obj;
      for (const k of keys) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[k];
      }
      return cur;
    };

    // Primary path on current Nike pages — selectedProduct at pageProps level
    const p1 = get(root, 'props', 'pageProps', 'selectedProduct');
    if (this.looksLikeSelectedProduct(p1)) return p1 as NikeSelectedProduct;

    // Legacy path (older Nike builds use initialState)
    const p2 = get(root, 'props', 'pageProps', 'initialState', 'selectedProduct');
    if (this.looksLikeSelectedProduct(p2)) return p2 as NikeSelectedProduct;

    const threadsProducts = get(
      root,
      'props',
      'pageProps',
      'initialState',
      'Threads',
      'products',
    );
    if (threadsProducts && typeof threadsProducts === 'object') {
      const first = Object.values(
        threadsProducts as Record<string, unknown>,
      )[0];
      if (this.looksLikeSelectedProduct(first))
        return first as NikeSelectedProduct;
    }

    // Deep fallback
    const found = this.deepFind(root, 0);
    if (found) {
      this.logger.log('[nike] selectedProduct found via deep search');
    } else {
      const topKeys = Object.keys(root).join(', ');
      const ppKeys = Object.keys(
        (get(root, 'props', 'pageProps') as Record<string, unknown>) ?? {},
      ).join(', ');
      this.logger.warn(
        `[nike] selectedProduct not found. __NEXT_DATA__ top keys: ${topKeys} | pageProps keys: ${ppKeys}`,
      );
    }
    return found;
  }

  private deepFind(obj: unknown, depth: number): NikeSelectedProduct | null {
    if (depth > 8 || obj == null || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const r = this.deepFind(item, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const o = obj as Record<string, unknown>;
    if (this.looksLikeSelectedProduct(o)) return o as NikeSelectedProduct;
    if (
      'selectedProduct' in o &&
      this.looksLikeSelectedProduct(o.selectedProduct)
    ) {
      return o.selectedProduct as NikeSelectedProduct;
    }
    for (const val of Object.values(o)) {
      if (val && typeof val === 'object') {
        const r = this.deepFind(val, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  private looksLikeSelectedProduct(obj: unknown): boolean {
    if (obj == null || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (
      typeof (o.prices as Record<string, unknown>)?.currentPrice === 'number' &&
      (Array.isArray(o.contentImages) || typeof o.styleColor === 'string')
    );
  }

  private getColorwayImages(root: Record<string, unknown>): NikeColorway[] {
    const pp = (root?.props as Record<string, unknown>)
      ?.pageProps as Record<string, unknown>;
    return (pp?.colorwayImages ?? []) as NikeColorway[];
  }

  private extractImages(
    contentImages: NikeContentImage[] | undefined,
    colorwayImages: NikeColorway[],
    ogImage: string | null,
  ): string[] {
    const pick = (img: NikeContentImage): string | undefined =>
      img.properties?.squarish?.url ||
      img.properties?.portrait?.url ||
      img.properties?.landscape?.url;

    const urls: string[] = [];

    for (const img of contentImages ?? []) {
      const u = pick(img);
      if (u) urls.push(u);
    }

    if (urls.length === 0) {
      for (const cw of colorwayImages) {
        for (const img of cw.contentImages ?? []) {
          const u = pick(img);
          if (u) urls.push(u);
        }
      }
    }

    if (urls.length === 0 && ogImage) urls.push(ogImage);

    return [...new Set(urls)].slice(0, 20);
  }
}
