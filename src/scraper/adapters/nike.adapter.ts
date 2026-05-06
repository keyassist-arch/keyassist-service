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
  status?: string;
  skuId?: string;
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
}

interface NikeProductInfo {
  title?: string;
  subtitle?: string;
  fullTitle?: string;
  productDescription?: string;
  featuresAndBenefits?: string[];
}

interface NikeSelectedProduct {
  id?: string;
  contentImages?: NikeContentImage[];
  prices?: NikePrices;
  sizes?: NikeSize[];
  colorDescription?: string;
  styleColor?: string;
  statusModifier?: string;
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
    const context = await this.playwright.newScrapeContext({}, url);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });

      // Wait until __NEXT_DATA__ is populated with product price — or give up after 20s.
      await page
        .waitForFunction(
          () => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el?.textContent) return false;
            try {
              const d = JSON.parse(el.textContent) as Record<string, unknown>;
              const pp = (d?.props as Record<string, unknown>)
                ?.pageProps as Record<string, unknown>;
              const state = pp?.initialState as Record<string, unknown>;
              const sel = state?.selectedProduct as Record<string, unknown>;
              const prices = sel?.prices as Record<string, unknown>;
              return typeof prices?.currentPrice === 'number';
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

      this.logger.warn('[nike] __NEXT_DATA__ parse failed — falling through to generic');
      // Log a snippet of the raw JSON so we can diagnose the live page structure
      if (raw.nextDataJson) {
        this.logger.warn(`[nike] __NEXT_DATA__ snippet: ${raw.nextDataJson.slice(0, 300)}`);
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

    // ── Title ──────────────────────────────────────────────────────────────
    const info = selected.productInfo;
    const title =
      info?.fullTitle ||
      info?.title ||
      raw.titleFallback ||
      'Nike Product';

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
    const description = descParts.join('\n\n') || undefined;

    // ── Variants & sizes ───────────────────────────────────────────────────
    const sizeList = selected.sizes ?? [];
    const sizeOptions = sizeList.map((s) => s.label).filter(Boolean);

    const variants: { name: string; options: string[] }[] = [];
    if (sizeOptions.length) variants.push({ name: 'Size', options: sizeOptions });

    const colorDescription = selected.colorDescription;
    if (colorDescription) {
      variants.push({ name: 'Color', options: [colorDescription] });
    }

    // ── Per-size configuration prices ──────────────────────────────────────
    const configurationPrices: ProductConfigurationPrice[] = sizeList.map((s) => ({
      label: s.label,
      originalPrice: priceStr,
      sku: s.skuId,
      variantAxis: 'Size',
      optionValue: s.label,
      variantSelections: { Size: s.label },
      available: s.status === 'ACTIVE',
      currency,
    }));

    // ── Availability ───────────────────────────────────────────────────────
    const statusMod = selected.statusModifier ?? '';
    const availability = statusMod.includes('BUYABLE') ? 'In Stock' : 'Out of Stock';

    return {
      title,
      price: priceStr,
      currency,
      images,
      description,
      brand: 'Nike',
      asin: selected.styleColor,
      variants,
      configurationPrices: configurationPrices.length ? configurationPrices : undefined,
      availability,
    };
  }

  /**
   * Recursively searches the entire __NEXT_DATA__ tree for any object that looks
   * like a Nike selectedProduct. This handles any app version / path variation.
   */
  private findSelectedProduct(
    root: Record<string, unknown>,
  ): NikeSelectedProduct | null {
    // Fast-path: known stable paths first (avoids deep walk when they match)
    const get = (obj: unknown, ...keys: string[]): unknown => {
      let cur = obj;
      for (const k of keys) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[k];
      }
      return cur;
    };

    const p1 = get(root, 'props', 'pageProps', 'initialState', 'selectedProduct');
    if (this.looksLikeSelectedProduct(p1)) return p1 as NikeSelectedProduct;

    const p2 = get(root, 'props', 'pageProps', 'selectedProduct');
    if (this.looksLikeSelectedProduct(p2)) return p2 as NikeSelectedProduct;

    const threadsProducts = get(root, 'props', 'pageProps', 'initialState', 'Threads', 'products');
    if (threadsProducts && typeof threadsProducts === 'object') {
      const first = Object.values(threadsProducts as Record<string, unknown>)[0];
      if (this.looksLikeSelectedProduct(first)) return first as NikeSelectedProduct;
    }

    // Deep fallback: walk the whole tree looking for any node named "selectedProduct"
    // or any product-shaped object with prices.currentPrice
    const found = this.deepFind(root, 0);
    if (found) {
      this.logger.log('[nike] selectedProduct found via deep search');
    } else {
      // Log top-level structure to help diagnose the live page layout
      const topKeys = Object.keys(root).join(', ');
      const ppKeys = Object.keys((get(root, 'props', 'pageProps') as Record<string, unknown>) ?? {}).join(', ');
      this.logger.warn(`[nike] selectedProduct not found. __NEXT_DATA__ top keys: ${topKeys} | pageProps keys: ${ppKeys}`);
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
    // If this object IS a selectedProduct, return it
    if (this.looksLikeSelectedProduct(o)) return o as NikeSelectedProduct;
    // If a key named "selectedProduct" exists and looks right, return it
    if ('selectedProduct' in o && this.looksLikeSelectedProduct(o.selectedProduct)) {
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
    const v = (root as Record<string, unknown>)?.props;
    const pp = (v as Record<string, unknown>)?.pageProps as Record<string, unknown>;
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
