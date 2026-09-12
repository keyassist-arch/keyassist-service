import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { scrapeDoGet } from '../utils/scrape-do-client.util';

// ─── GOAT JSON shapes (from __NEXT_DATA__) ────────────────────────────────────
//
// Per-size lowest asks often live in `availableSizesNewV2` / `availableSizesNew`
// (filled after client fetch). `sizeOptions` is the size list; merge by `value` ↔ `size`.

interface GoatLocalizedPrice {
  currency?: string;
  amount?: number;
  amountUsdCents?: number;
}

interface GoatSizeOption {
  presentation: string;
  value?: number;
  lowestPriceCents?: { amount: number; currency: string } | number | null;
  localizedLowestPriceCents?: GoatLocalizedPrice | null;
  available?: boolean;
}

/** Rows from availableSizesNew / availableSizesNewV2 (field names vary by GOAT version) */
interface GoatAvailableSizeRow {
  presentation?: string;
  name?: string;
  sizeLabel?: string;
  value?: number;
  size?: number;
  available?: boolean;
  lowestPriceCents?: { amount: number; currency: string } | number | null;
  localizedLowestPriceCents?: GoatLocalizedPrice | null;
  newLowestPriceCents?: unknown;
  usedLowestPriceCents?: unknown;
  localizedSpecialDisplayPriceCents?: GoatLocalizedPrice | null;
  minimumOfferCents?: number;
}

interface GoatExternalPicture {
  mainPictureUrl?: string;
  gridPictureUrl?: string;
}

interface GoatProductData {
  id?: number;
  name?: string;
  brand?: string | { name?: string };
  brandName?: string;
  details?: string;
  description?: string;
  mainPictureUrl?: string;
  pictureUrl?: string;
  gridPictureUrl?: string;
  mainGlowPictureUrl?: string;
  gridGlowPictureUrl?: string;
  productTemplateExternalPictures?: GoatExternalPicture[];
  sizeOptions?: GoatSizeOption[];
  availableSizesNew?: GoatAvailableSizeRow[];
  availableSizesNewV2?: GoatAvailableSizeRow[];
  availableSizesNewWithDefects?: GoatAvailableSizeRow[];
  lowestPriceCents?: { amount: number; currency: string } | number | null;
  specialDisplayPriceCents?: number;
  localizedSpecialDisplayPriceCents?: GoatLocalizedPrice;
  minimumOfferCents?: number;
  maximumOfferCents?: number;
  productCondition?: string;
  colorway?: string;
  sku?: string;
  slug?: string;
}

interface GoatNextData {
  props?: {
    pageProps?: {
      product?: GoatProductData;
      productTemplate?: GoatProductData;
      apolloState?: Record<string, unknown>;
    };
  };
}

interface ParsedCents {
  cents: number;
  currency: string;
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function normaliseImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http')) return url;
  return `https://${url}`;
}

/** Normalize GOAT “cents” fields: number, or { amount, currency } */
function parseCentsField(v: unknown): ParsedCents | null {
  if (v == null) return null;
  if (typeof v === 'number' && v > 0) {
    return { cents: v, currency: 'USD' };
  }
  if (typeof v === 'object' && v !== null && 'amount' in v) {
    const o = v as { amount?: number; currency?: string };
    if (typeof o.amount === 'number' && o.amount > 0) {
      return {
        cents: o.amount,
        currency: (o.currency ?? 'USD').toUpperCase(),
      };
    }
  }
  return null;
}

function centsFromSizeOption(so: GoatSizeOption): ParsedCents | null {
  return (
    parseCentsField(so.localizedLowestPriceCents) ??
    parseCentsField(so.lowestPriceCents)
  );
}

function centsFromAvailableRow(row: GoatAvailableSizeRow): ParsedCents | null {
  const tryFields: unknown[] = [
    row.localizedLowestPriceCents,
    row.lowestPriceCents,
    row.newLowestPriceCents,
    row.usedLowestPriceCents,
    row.localizedSpecialDisplayPriceCents,
  ];
  for (const f of tryFields) {
    const p = parseCentsField(f);
    if (p) return p;
  }
  if (typeof row.minimumOfferCents === 'number' && row.minimumOfferCents > 0) {
    return { cents: row.minimumOfferCents, currency: 'USD' };
  }
  return null;
}

function rowNumericKey(row: GoatAvailableSizeRow): number | undefined {
  if (typeof row.value === 'number') return row.value;
  if (typeof row.size === 'number') return row.size;
  return undefined;
}

function presentationFromRow(row: GoatAvailableSizeRow): string {
  const p =
    row.presentation ?? row.sizeLabel ?? row.name ?? row.size ?? row.value;
  return p != null ? String(p) : '?';
}

/**
 * Merged size row: label + optional per-size lowest ask (when GOAT provides it).
 */
interface MergedGoatSize {
  presentation: string;
  value?: number;
  cents: number | null;
  currency: string;
  available: boolean;
}

function mergeGoatSizes(pt: GoatProductData): MergedGoatSize[] {
  const sizeOptions = pt.sizeOptions ?? [];
  const availCandidates = [
    pt.availableSizesNewV2,
    pt.availableSizesNew,
    pt.availableSizesNewWithDefects,
  ];
  const avail = availCandidates.find(
    (a): a is GoatAvailableSizeRow[] => Array.isArray(a) && a.length > 0,
  );

  if (avail) {
    const byValue = new Map<number, GoatAvailableSizeRow>();
    for (const row of avail) {
      const k = rowNumericKey(row);
      if (k != null && !Number.isNaN(k)) {
        byValue.set(k, row);
      }
    }

    if (sizeOptions.length > 0 && byValue.size > 0) {
      return sizeOptions.map((so) => {
        const row = so.value != null ? byValue.get(so.value) : undefined;
        const fromAvail = row ? centsFromAvailableRow(row) : null;
        const fromOpt = centsFromSizeOption(so);
        const pick = fromAvail ?? fromOpt;
        return {
          presentation: so.presentation,
          value: so.value,
          cents: pick?.cents ?? null,
          currency: pick?.currency ?? 'USD',
          available: row?.available !== false && so.available !== false,
        };
      });
    }

    return avail.map((row) => {
      const pick = centsFromAvailableRow(row);
      return {
        presentation: presentationFromRow(row),
        value: rowNumericKey(row),
        cents: pick?.cents ?? null,
        currency: pick?.currency ?? 'USD',
        available: row.available !== false,
      };
    });
  }

  return sizeOptions.map((so) => {
    const pick = centsFromSizeOption(so);
    return {
      presentation: so.presentation,
      value: so.value,
      cents: pick?.cents ?? null,
      currency: pick?.currency ?? 'USD',
      available: so.available !== false,
    };
  });
}

/**
 * Shape of GOAT's /web-api/v1/product_variants/buy_bar_data response — a bare
 * array of per-size/per-condition rows (not wrapped in `{ variants: [...] }`).
 * `sizeOption` is an object, not a scalar — earlier code treated it as one and
 * so silently matched zero rows.
 */
interface GoatBuyBarRow {
  sizeOption?: { presentation?: string; value?: number };
  shoeCondition?: string;
  lowestPriceCents?: { amount: number; currency?: string } | number | null;
  instantShipLowestPriceCents?: { amount: number; currency?: string } | number | null;
  lastSoldPriceCents?: { amount: number; currency?: string } | number | null;
  stockStatus?: string;
  available?: boolean;
}

type GoatBuyBarData = GoatBuyBarRow[] | { productVariants?: GoatBuyBarRow[]; variants?: GoatBuyBarRow[] };

function normalizeBuyBarRows(data: GoatBuyBarData): GoatBuyBarRow[] {
  if (Array.isArray(data)) return data;
  return data.productVariants ?? data.variants ?? [];
}

/**
 * After the XHR (or direct scrape.do) fetch resolves, overlay per-size prices
 * onto the merged size array. Matches by numeric `sizeOption.value` first,
 * then by presentation string.
 */
function mergeXhrPricesIntoSizes(
  merged: MergedGoatSize[],
  xhrData: GoatBuyBarData,
): MergedGoatSize[] {
  const rows = normalizeBuyBarRows(xhrData);
  if (!rows.length) return merged;

  const byPresentation = new Map<string, GoatBuyBarRow>();
  const byNumeric = new Map<number, GoatBuyBarRow>();

  for (const row of rows) {
    // Only "new, no defects" rows represent the standard lowest ask — a
    // product can have separate used/defect rows for the same size.
    if (row.shoeCondition && row.shoeCondition !== 'new_no_defects') continue;
    const so = row.sizeOption;
    if (!so) continue;
    if (so.presentation != null) byPresentation.set(String(so.presentation), row);
    if (typeof so.value === 'number' && !Number.isNaN(so.value)) byNumeric.set(so.value, row);
  }

  return merged.map((m) => {
    const row =
      (m.value != null ? byNumeric.get(m.value) : undefined) ??
      byPresentation.get(m.presentation);
    if (!row) return m;

    const raw = row.lowestPriceCents ?? row.instantShipLowestPriceCents;
    const pick = parseCentsField(raw);
    if (!pick) return m;

    return {
      ...m,
      cents: pick.cents,
      currency: pick.currency,
      available: row.available ?? row.stockStatus !== 'out_of_stock',
    };
  });
}

/**
 * Template-level “from” price when per-size asks are missing.
 */
function resolveGoatDisplayPrice(product: GoatProductData): ParsedCents | null {
  const loc = product.localizedSpecialDisplayPriceCents;
  if (
    loc &&
    typeof loc === 'object' &&
    typeof loc.amount === 'number' &&
    loc.amount > 0
  ) {
    return {
      cents: loc.amount,
      currency: (loc.currency ?? 'USD').toUpperCase(),
    };
  }

  const spec = product.specialDisplayPriceCents;
  if (typeof spec === 'number' && spec > 0) {
    return { cents: spec, currency: 'USD' };
  }

  const lp = product.lowestPriceCents;
  if (lp != null && typeof lp === 'object' && typeof lp.amount === 'number') {
    if (lp.amount > 0) {
      return {
        cents: lp.amount,
        currency: (lp.currency ?? 'USD').toUpperCase(),
      };
    }
  } else if (typeof lp === 'number' && lp > 0) {
    return { cents: lp, currency: 'USD' };
  }

  const minOffer = product.minimumOfferCents;
  if (typeof minOffer === 'number' && minOffer > 0) {
    return { cents: minOffer, currency: 'USD' };
  }

  return null;
}

function collectGoatImages(product: GoatProductData): string[] {
  const out: string[] = [];
  const push = (u?: string) => {
    const n = u ? normaliseImageUrl(u) : '';
    if (n && !out.includes(n)) out.push(n);
  };
  push(product.mainPictureUrl);
  push(product.pictureUrl);
  push(product.mainGlowPictureUrl);
  push(product.gridPictureUrl);
  push(product.gridGlowPictureUrl);
  for (const row of product.productTemplateExternalPictures ?? []) {
    if (row && typeof row === 'object') {
      push(row.mainPictureUrl);
      push(row.gridPictureUrl);
    }
  }
  return out;
}

function extractGoatProduct(nextData: GoatNextData): GoatProductData | null {
  const pp = nextData?.props?.pageProps;
  if (!pp) return null;

  if (pp.product && pp.product.name) return pp.product;
  if (pp.productTemplate && pp.productTemplate.name) return pp.productTemplate;

  const apollo = pp.apolloState;
  if (apollo) {
    for (const val of Object.values(apollo)) {
      if (!val || typeof val !== 'object' || !('name' in val)) continue;
      const o = val as Record<string, unknown>;
      if (
        'lowestPriceCents' in o ||
        'minimumOfferCents' in o ||
        'specialDisplayPriceCents' in o ||
        'localizedSpecialDisplayPriceCents' in o
      ) {
        return val as GoatProductData;
      }
    }
  }

  return null;
}

function readNextDataJson(): string {
  const el = document.querySelector('script#__NEXT_DATA__');
  return el?.textContent ?? '';
}

@Injectable()
export class GoatAdapter implements ScraperAdapter {
  readonly source = ProductSource.GOAT;
  private readonly logger = new Logger(GoatAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  /**
   * Fetch per-size lowest-ask prices directly through scrape.do rather than
   * relying on the local browser to fire the buy_bar_data XHR itself: without
   * a residential proxy, GOAT's API blocks that request when it originates
   * from the scraper's own (datacenter) IP, whereas scrape.do's proxy pool
   * can reach it. Always pin countryCode=US so prices come back in USD
   * regardless of which country scrape.do happened to route the request
   * through for the page fetch.
   */
  private async fetchBuyBarDataViaScrapeDo(productTemplateId: number): Promise<GoatBuyBarData | null> {
    const token = this.config.get<string>('SCRAPE_DO_TOKEN')?.trim();
    if (!token) return null;
    try {
      const buyBarUrl = `https://www.goat.com/web-api/v1/product_variants/buy_bar_data?productTemplateId=${productTemplateId}&countryCode=US`;
      const { data } = await scrapeDoGet<GoatBuyBarData>(token, buyBarUrl, { super: 'true' });
      return data ?? null;
    } catch (e) {
      this.logger.warn(
        `GoatAdapter: buy_bar_data scrape.do fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const navTimeout = this.config.get<string>('SCRAPE_PROXY')?.trim() ? 90_000 : 45_000;

    const { page, context } = await this.playwright.loadPage(url, {
      contextOverrides: {
        locale: 'en-US',
      },
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: navTimeout },
    });

    try {
      // Intercept GOAT's per-size pricing XHR before React fires it post-hydration.
      // __NEXT_DATA__ only carries size labels; actual lowest asks come from this endpoint.
      let goatBuyBarData: GoatBuyBarData | null = null;
      await page.route('**/product_variants/buy_bar_data**', async (route) => {
        try {
          const response = await route.fetch();
          goatBuyBarData = (await response.json()) as GoatBuyBarData;
          await route.fulfill({ response });
        } catch {
          await route.continue();
        }
      });

      await page
        .waitForSelector('script#__NEXT_DATA__', { timeout: 15_000 })
        .catch(() => undefined);

      await page
        .waitForLoadState('networkidle', { timeout: 25_000 })
        .catch(() => {
          /* GOAT is chatty; continue with whatever loaded */
        });

      // Client may fill `availableSizesNewV2` after XHR; __NEXT_DATA__ is usually static,
      // but a short pause helps live Playwright / Scrape.do timing.
      await new Promise((r) => setTimeout(r, 2_500));

      let raw = await page.evaluate(readNextDataJson);

      if (!raw) {
        this.logger.warn(`GoatAdapter: no __NEXT_DATA__ found at ${url}`);
        return this.generic.scrape(url);
      }

      let nextData = JSON.parse(raw) as GoatNextData;
      let product = extractGoatProduct(nextData);
      let merged = product ? mergeGoatSizes(product) : [];
      const hasPerSize = merged.some((m) => m.cents != null && m.cents > 0);

      // Second read: some builds refresh embedded JSON (rare); cheap retry.
      if (!hasPerSize && (product?.sizeOptions?.length ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, 2_000));
        raw = await page.evaluate(readNextDataJson);
        if (raw) {
          try {
            nextData = JSON.parse(raw) as GoatNextData;
            product = extractGoatProduct(nextData);
            if (product) merged = mergeGoatSizes(product);
          } catch {
            /* keep previous */
          }
        }
      }

      if (!product) {
        this.logger.warn(
          `GoatAdapter: could not extract product from __NEXT_DATA__ at ${url}`,
        );
        return this.generic.scrape(url);
      }

      // If __NEXT_DATA__ had no per-size prices, overlay them from the locally
      // captured XHR response (works only when a residential SCRAPE_PROXY is set).
      if (!merged.some((m) => m.cents != null && m.cents > 0) && goatBuyBarData) {
        merged = mergeXhrPricesIntoSizes(merged, goatBuyBarData);
      }

      // Still nothing — fetch buy_bar_data directly through scrape.do, which
      // reaches GOAT's API through its own proxy pool instead of ours.
      if (!merged.some((m) => m.cents != null && m.cents > 0) && product.id != null) {
        const fetched = await this.fetchBuyBarDataViaScrapeDo(product.id);
        if (fetched) merged = mergeXhrPricesIntoSizes(merged, fetched);
      }

      const pricedSizes = merged.filter((m) => m.cents != null && m.cents > 0);
      const resolved = resolveGoatDisplayPrice(product);

      let priceStr: string | null = null;
      let currency = 'USD';

      if (pricedSizes.length > 0) {
        const minRow = pricedSizes.reduce((a, b) =>
          b.cents! < a.cents! ? b : a,
        );
        priceStr = centsToDecimal(minRow.cents!);
        currency = minRow.currency;
      } else if (resolved) {
        priceStr = centsToDecimal(resolved.cents);
        currency = resolved.currency;
      }

      if (!product.name || !priceStr) {
        this.logger.warn(
          `GoatAdapter: missing name or price at ${url} — ` +
            `name="${product.name}" price="${priceStr}"`,
        );
        return this.generic.scrape(url);
      }

      const images = collectGoatImages(product);

      const availableMerged = merged.filter((m) => m.available);
      const variantSource =
        availableMerged.length > 0 ? availableMerged : merged;

      /** Selectable size labels — pair with `configurationPrices` rows via `optionValue`. */
      const variants: ScrapedProduct['variants'] = merged.length
        ? [{ name: 'Size', options: variantSource.map((m) => m.presentation) }]
        : [];

      const SIZE_AXIS = 'Size';
      const configurationPrices = pricedSizes.map((m) => {
        const originalPrice = centsToDecimal(m.cents!);
        return {
          label: `${SIZE_AXIS} ${m.presentation}`,
          originalPrice,
          variantAxis: SIZE_AXIS,
          optionValue: m.presentation,
          currency: m.currency,
          available: m.available,
          displayLabel: `${m.presentation} — from ${m.currency} ${originalPrice}`,
          metadata: {
            source: 'goat',
            sizeValue: m.value ?? null,
          },
        };
      });

      const brand =
        product.brandName?.trim() ||
        (typeof product.brand === 'string'
          ? product.brand
          : (product.brand?.name ?? undefined));

      const descParts: string[] = [];
      if (product.details) descParts.push(product.details.trim());
      if (product.description && product.description !== product.details)
        descParts.push(product.description.trim());
      if (product.colorway) descParts.push(`Colorway: ${product.colorway}`);
      if (product.sku) descParts.push(`Style: ${product.sku}`);
      if (product.productCondition)
        descParts.push(
          `Condition: ${product.productCondition.replace(/_/g, ' ')}`,
        );

      const distinctPrices = new Set(
        pricedSizes.map((m) => `${m.currency}:${m.cents}`),
      );
      if (distinctPrices.size > 1) {
        descParts.push(
          'Lowest ask varies by size (per-size prices are listed in variants and configuration prices).',
        );
      }

      const hasSizes = merged.length > 0;
      const availability =
        !hasSizes ||
        availableMerged.length > 0 ||
        pricedSizes.length > 0 ||
        resolved != null
          ? 'in_stock'
          : 'out_of_stock';

      return {
        title: product.name,
        price: priceStr,
        currency,
        images,
        brand,
        description: descParts.join('\n\n') || undefined,
        variants,
        configurationPrices: configurationPrices.length
          ? configurationPrices
          : undefined,
        availability,
      };
    } catch (err) {
      this.logger.error(
        `GoatAdapter: failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.generic.scrape(url);
    } finally {
      await context.close();
    }
  }
}
