import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';
import { currencyFromPriceString } from '../utils/currency-symbol.util';

interface MetricsSku {
  sku: string;
  partNumber: string;
  name: string;
  fullPrice: number;
}

interface ConfigRow {
  summary: string;
  href: string;
  priceText: string;
  storage: string;
  color: string;
  carrier: string;
}

interface ApplePagePayload {
  title: string;
  brand: string;
  ldLow: number | null;
  ldHigh: number | null;
  ldCurrency: string;
  ldDescription: string;
  ldImages: string[];
  pictureSourcesets: string[];
  imgSrcs: string[];
  configRows: ConfigRow[];
  metricsSkus: MetricsSku[];
  currentPath: string;
}

/** Words that appear in Apple product names but are NOT color tokens. */
const APPLE_PRODUCT_NOUNS = new Set([
  'iphone',
  'ipad',
  'mac',
  'macbook',
  'pro',
  'max',
  'plus',
  'air',
  'mini',
  'apple',
  'watch',
  'ultra',
  'titanium-finish',
  'aluminum',
  'stainless',
  'steel',
]);

/** Extract { Storage, Color } from an Apple SKU name like "iPhone 17 256GB Black Titanium". */
function parseSkuVariants(name: string): Record<string, string> {
  const storageM = name.match(/\b(\d+)\s*(GB|TB)\b/i);
  const selections: Record<string, string> = {};
  if (storageM) {
    selections['Storage'] = `${storageM[1]} ${storageM[2].toUpperCase()}`;
    const afterStorage = name
      .slice(name.indexOf(storageM[0]) + storageM[0].length)
      .replace(/\s+/g, ' ')
      .trim();
    if (afterStorage && !APPLE_PRODUCT_NOUNS.has(afterStorage.toLowerCase())) {
      selections['Color'] = afterStorage;
    }
  }
  return selections;
}

function storageTierKey(s: string): number {
  const m = s.match(/^(\d+)\s*(GB|TB)$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return m[2].toUpperCase() === 'TB' ? n * 1024 : n;
}

function bestFromSrcset(srcset: string): string {
  if (!srcset.trim()) return '';
  const entries = srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .filter((parts) => parts[0]);
  let best = entries[0]?.[0] ?? '';
  let bestVal = 0;
  for (const [url, descriptor = '1x'] of entries) {
    const num = parseFloat(descriptor.replace(/[xw]/i, ''));
    if (!Number.isNaN(num) && num > bestVal) {
      bestVal = num;
      best = url;
    }
  }
  return best;
}

function matchSkuToSlug(slug: string, skus: MetricsSku[]): MetricsSku | null {
  if (!skus.length || !slug) return null;
  const s = slug.toLowerCase().replace(/-/g, ' ');
  let best: MetricsSku | null = null;
  let bestScore = -1;
  for (const sku of skus) {
    const name = sku.name.toLowerCase();
    let score = 0;
    const storageM = name.match(/\b(\d+)\s*(gb|tb)\b/i);
    if (storageM) {
      const token = `${storageM[1]}${storageM[2].toLowerCase()}`;
      if (s.includes(token)) score += 3;
    }
    const skipWords = new Set([
      'iphone',
      'ipad',
      'mac',
      'macbook',
      'pro',
      'max',
      'plus',
      'air',
      'mini',
      'apple',
      'watch',
      'ultra',
      'gb',
      'tb',
      'inch',
    ]);
    const nameWords = name
      .split(/\s+/)
      .filter((w) => w.length > 2 && !skipWords.has(w) && !/^\d+$/.test(w));
    for (const w of nameWords) {
      if (s.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sku;
    }
  }
  return bestScore >= 3 ? best : null;
}

function skuFromQueryParam(url: string, skus: MetricsSku[]): MetricsSku | null {
  const params = new URL(url).searchParams;
  const raw = (
    params.get('part') ??
    params.get('sku') ??
    params.get('partNumber') ??
    params.get('part_number') ??
    params.get('item') ??
    ''
  ).trim();
  if (!raw) return null;
  return (
    skus.find(
      (s) =>
        s.partNumber === raw || s.sku === raw || s.partNumber.startsWith(raw),
    ) ?? null
  );
}

function buildVariantsFromSkus(
  skus: MetricsSku[],
): { name: string; options: string[] }[] {
  if (!skus.length) return [];
  const storages = new Set<string>();
  const colors = new Set<string>();
  for (const sku of skus) {
    const sel = parseSkuVariants(sku.name);
    if (sel['Storage']) storages.add(sel['Storage']);
    if (sel['Color']) colors.add(sel['Color']);
  }
  const out: { name: string; options: string[] }[] = [];
  if (storages.size > 1 || (storages.size === 1 && colors.size === 0)) {
    out.push({
      name: 'Storage',
      options: [...storages].sort(
        (a, b) => storageTierKey(a) - storageTierKey(b),
      ),
    });
  }
  if (colors.size) {
    out.push({ name: 'Color', options: [...colors].sort() });
  }
  return out;
}

/** Per-SKU supplier prices from `script#metrics` (storage × color hardware). */
function buildConfigurationPricesFromSkus(
  skus: MetricsSku[],
): ProductConfigurationPrice[] {
  return skus
    .map((s) => {
      const variantSelections = parseSkuVariants(s.name);
      return {
        label: s.name,
        originalPrice: s.fullPrice.toFixed(2),
        partNumber: s.partNumber,
        sku: s.sku,
        ...(Object.keys(variantSelections).length ? { variantSelections } : {}),
      };
    })
    .sort((a, b) => parseFloat(a.originalPrice) - parseFloat(b.originalPrice));
}

/** Matrix rows when metrics are missing — label omits redundant price in summary where possible */
function buildConfigurationPricesFromRows(
  rows: ConfigRow[],
): ProductConfigurationPrice[] {
  const out: ProductConfigurationPrice[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const p = parsePriceToDecimalString(r.priceText);
    if (!p) continue;
    const label = [r.storage, r.color, r.carrier].filter(Boolean).join(' · ');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const variantSelections: Record<string, string> = {};
    if (r.storage) variantSelections['Storage'] = r.storage;
    if (r.color) variantSelections['Color'] = r.color;
    if (r.carrier) variantSelections['Carrier'] = r.carrier;
    out.push({
      label,
      originalPrice: p,
      ...(Object.keys(variantSelections).length ? { variantSelections } : {}),
    });
  }
  return out.sort(
    (a, b) => parseFloat(a.originalPrice) - parseFloat(b.originalPrice),
  );
}

function buildVariantsFromRows(
  rows: ConfigRow[],
): { name: string; options: string[] }[] {
  const storages = new Set<string>();
  const colors = new Set<string>();
  const carriers = new Set<string>();
  for (const row of rows) {
    if (row.storage) storages.add(row.storage);
    if (row.color) colors.add(row.color);
    if (row.carrier) carriers.add(row.carrier);
  }
  const out: { name: string; options: string[] }[] = [];
  if (storages.size) {
    out.push({
      name: 'Storage',
      options: [...storages].sort(
        (a, b) => storageTierKey(a) - storageTierKey(b),
      ),
    });
  }
  if (colors.size) out.push({ name: 'Color', options: [...colors].sort() });
  if (carriers.size)
    out.push({ name: 'Carrier', options: [...carriers].sort() });
  return out;
}

@Injectable()
export class AppleAdapter implements ScraperAdapter {
  readonly source = ProductSource.APPLE;
  private readonly logger = new Logger(AppleAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const context = await this.playwright.newScrapeContext(
      {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
      },
      url,
    );

    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .waitForSelector(
          'a[data-slot-name="productSelection"], script#metrics, script[type="application/ld+json"]',
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));

      const raw = await page.evaluate((): ApplePagePayload => {
        function cleanText(el: Element | null): string {
          if (!el) return '';
          const clone = el.cloneNode(true) as Element;
          clone
            .querySelectorAll('as-footnote, sup.as-footnote, sup[aria-label]')
            .forEach((n) => n.remove());
          return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
        }

        function normPath(p: string) {
          return p.replace(/\/$/, '') || '/';
        }

        let title = '';
        let ldLow: number | null = null;
        let ldHigh: number | null = null;
        let ldCurrency = '';
        let ldDescription = '';
        const ldImages: string[] = [];

        for (const s of document.querySelectorAll(
          'script[type="application/ld+json"]',
        )) {
          try {
            const j = JSON.parse(s.textContent ?? '{}') as unknown;
            const nodes: unknown[] = Array.isArray(j) ? j : [j];
            for (const node of nodes) {
              if (!node || typeof node !== 'object') continue;
              const o = node as Record<string, unknown>;
              const t = o['@type'];
              const isProduct =
                t === 'Product' ||
                (Array.isArray(t) && (t as string[]).includes('Product'));
              if (!isProduct) continue;
              if (!title && typeof o.name === 'string') title = o.name;
              if (!ldDescription && typeof o.description === 'string') {
                ldDescription = o.description;
              }
              const img = o.image;
              if (typeof img === 'string') ldImages.push(img);
              else if (Array.isArray(img)) {
                ldImages.push(
                  ...(img as string[]).filter((x) => typeof x === 'string'),
                );
              }
              const offers = Array.isArray(o.offers)
                ? o.offers
                : o.offers
                  ? [o.offers]
                  : [];
              for (const off of offers) {
                if (typeof off !== 'object' || !off) continue;
                const ag = off as Record<string, unknown>;
                if (ag['@type'] !== 'AggregateOffer') continue;
                if (
                  typeof ag.lowPrice === 'number' &&
                  !Number.isNaN(ag.lowPrice)
                ) {
                  ldLow = ag.lowPrice;
                }
                if (
                  typeof ag.highPrice === 'number' &&
                  !Number.isNaN(ag.highPrice)
                ) {
                  ldHigh = ag.highPrice;
                }
                if (typeof ag.priceCurrency === 'string')
                  ldCurrency = ag.priceCurrency;
              }
            }
          } catch {
            /* skip */
          }
        }

        if (!title) {
          title =
            document
              .querySelector('[data-autom="productTitle"]')
              ?.textContent?.trim() ||
            document.querySelector('h1.rich-headline')?.textContent?.trim() ||
            document.querySelector('h1')?.textContent?.trim() ||
            '';
        }
        title = title.replace(/\s+/g, ' ').trim();

        const brand =
          document
            .querySelector('meta[property="og:site_name"]')
            ?.getAttribute('content')
            ?.trim() || 'Apple';

        const pictureSourcesets: string[] = [];
        const imgSrcs: string[] = [];
        for (const source of document.querySelectorAll(
          '.gallery picture source, .rf-gallery picture source',
        )) {
          const ss = source.getAttribute('srcset') ?? '';
          if (ss) pictureSourcesets.push(ss);
        }
        for (const img of document.querySelectorAll(
          '.gallery img, .rf-gallery img',
        )) {
          const src = (img as HTMLImageElement).src;
          if (src && !src.startsWith('data:')) imgSrcs.push(src);
          const ss = img.getAttribute('srcset') ?? '';
          if (ss) pictureSourcesets.push(ss);
        }
        const og = document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute('content');
        if (og) imgSrcs.push(og);

        const metricsSkus: MetricsSku[] = [];
        const metricsEl = document.querySelector('script#metrics');
        if (metricsEl?.textContent) {
          try {
            const m = JSON.parse(metricsEl.textContent) as {
              data?: { products?: unknown[] };
            };
            for (const p of m?.data?.products ?? []) {
              if (!p || typeof p !== 'object') continue;
              const rec = p as Record<string, unknown>;
              const priceObj = rec.price as Record<string, unknown> | undefined;
              const fp = priceObj?.fullPrice;
              const partNumber =
                typeof rec.partNumber === 'string' ? rec.partNumber : '';
              const name = typeof rec.name === 'string' ? rec.name : '';
              const sku = typeof rec.sku === 'string' ? rec.sku : '';
              if (typeof fp === 'number' && !Number.isNaN(fp) && partNumber) {
                metricsSkus.push({ sku, partNumber, name, fullPrice: fp });
              }
            }
          } catch {
            /* malformed */
          }
        }

        const currentPath = normPath(window.location.pathname);
        const configRows: ConfigRow[] = [];
        const seen = new Set<string>();
        for (const a of document.querySelectorAll(
          'a[data-slot-name="productSelection"]',
        )) {
          const capEl = a.querySelector('.dimensionCapacity');
          const storageRaw = cleanText(capEl)
            .replace(
              /(\d+)\s*(GB|TB)\b/gi,
              (_, n, u) => `${n} ${u.toUpperCase()}`,
            )
            .trim();
          const storageM = storageRaw.match(/\b(\d+\s*(?:GB|TB))\b/i);
          const storage = storageM ? storageM[1] : '';
          const color = cleanText(a.querySelector('.dimensionColor')).trim();
          const carrier = cleanText(a.querySelector('.carrier-logos')).trim();
          const priceText = cleanText(a.querySelector('.current_price')).trim();
          const parts = [storage, color, carrier].filter(Boolean);
          if (!parts.length) continue;
          const summary =
            parts.join(' · ') + (priceText ? ` — ${priceText}` : '');
          const key = summary.replace(/\s+/g, ' ');
          if (seen.has(key)) continue;
          seen.add(key);
          let href = '';
          try {
            const rawHref = a.getAttribute('href') ?? '';
            href = normPath(new URL(rawHref, window.location.origin).pathname);
          } catch {
            /* bad href */
          }
          configRows.push({
            summary,
            href,
            priceText,
            storage,
            color,
            carrier,
          });
        }

        return {
          title,
          brand,
          ldLow,
          ldHigh,
          ldCurrency,
          ldDescription,
          ldImages,
          pictureSourcesets,
          imgSrcs,
          configRows,
          metricsSkus,
          currentPath,
        };
      });

      const skus = raw.metricsSkus;
      const slug = raw.currentPath.split('/').filter(Boolean).pop() ?? '';
      const paramSku = skuFromQueryParam(url, skus);
      const slugSku = paramSku ? null : matchSkuToSlug(slug, skus);
      const urlMatchedRow = raw.configRows.find(
        (r) => r.href === raw.currentPath && r.priceText,
      );

      const priceStr =
        (paramSku ? paramSku.fullPrice.toFixed(2) : null) ??
        (slugSku ? slugSku.fullPrice.toFixed(2) : null) ??
        (urlMatchedRow
          ? parsePriceToDecimalString(urlMatchedRow.priceText)
          : null) ??
        raw.configRows
          .map((r) => parsePriceToDecimalString(r.priceText))
          .filter((p): p is string => !!p)
          .sort((a, b) => parseFloat(a) - parseFloat(b))[0] ??
        (skus.length
          ? Math.min(...skus.map((s) => s.fullPrice)).toFixed(2)
          : null) ??
        (raw.ldLow != null ? raw.ldLow.toFixed(2) : null);

      if (!raw.title || !priceStr) {
        this.logger.warn(
          `AppleAdapter: incomplete for ${url} — title="${raw.title}" price="${priceStr}". Falling back.`,
        );
        return this.generic.scrape(url);
      }

      const images = this.resolveImages(raw);
      const variants = skus.length
        ? buildVariantsFromSkus(skus)
        : buildVariantsFromRows(raw.configRows);

      const descParts: string[] = [];
      if (raw.ldDescription)
        descParts.push(raw.ldDescription.slice(0, 800).trim());
      const priceSymbolCurrency =
        raw.configRows
          .map((r) => currencyFromPriceString(r.priceText))
          .find((c) => !!c) ?? null;
      const currency = (priceSymbolCurrency || raw.ldCurrency || 'USD')
        .toUpperCase()
        .slice(0, 8);
      const priceNums = skus.length
        ? skus.map((s) => s.fullPrice)
        : raw.configRows
            .map((r) =>
              parseFloat(parsePriceToDecimalString(r.priceText) ?? ''),
            )
            .filter((n) => !Number.isNaN(n));
      if (priceNums.length > 1) {
        const lo = Math.min(...priceNums);
        const hi = Math.max(...priceNums);
        if (hi - lo > 50) {
          descParts.push(
            `Available from ${currency} ${lo.toFixed(2)} to ${currency} ${hi.toFixed(2)} depending on configuration.`,
          );
        }
      }
      const priceSource = paramSku
        ? `query param → metrics SKU ${paramSku.partNumber}`
        : slugSku
          ? `slug match → metrics SKU ${slugSku.partNumber}`
          : urlMatchedRow
            ? 'URL-matched config row'
            : skus.length
              ? 'cheapest metrics SKU'
              : raw.configRows.length
                ? 'cheapest config row'
                : 'JSON-LD lowPrice';
      this.logger.debug(
        `AppleAdapter: ${url} — price=${priceStr} source=${priceSource}`,
      );

      const configurationPrices = skus.length
        ? buildConfigurationPricesFromSkus(skus)
        : buildConfigurationPricesFromRows(raw.configRows);

      return {
        title: raw.title,
        price: priceStr,
        currency,
        images,
        brand: raw.brand || 'Apple',
        description: descParts.join('\n\n') || undefined,
        variants,
        configurationSummaries: raw.configRows.map((r) => r.summary),
        ...(configurationPrices.length ? { configurationPrices } : {}),
      };
    } catch (err) {
      this.logger.error(
        `AppleAdapter: scrape failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.generic.scrape(url);
    } finally {
      await context.close();
    }
  }

  private resolveImages(raw: ApplePagePayload): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (u: string) => {
      const clean = u.trim();
      if (clean && !clean.startsWith('data:') && !seen.has(clean)) {
        seen.add(clean);
        urls.push(clean);
      }
    };
    for (const ss of raw.pictureSourcesets) add(bestFromSrcset(ss));
    for (const u of raw.ldImages) add(u);
    for (const u of raw.imgSrcs) add(u);
    return urls.slice(0, 24);
  }
}
