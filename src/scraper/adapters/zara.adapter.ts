import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

// ─── Zara JSON shapes ─────────────────────────────────────────────────────────

interface ZaraPrice {
  value: number;
  currency: string;
}

interface ZaraMedia {
  path?: string;
  url?: string;
  kind?: string;
}

interface ZaraSize {
  name?: string;
  availability?: string;
  sku?: string;
}

interface ZaraColor {
  name?: string;
  hexCode?: string;
  url?: string;
  sizes?: ZaraSize[];
  media?: { images?: ZaraMedia[] };
  selected?: boolean;
}

interface ZaraProductDetail {
  name?: string;
  description?: string;
  sectionName?: string;
  colors?: ZaraColor[];
  price?: ZaraPrice;
  salePrice?: ZaraPrice;
  originalPrice?: ZaraPrice;
  media?: { images?: ZaraMedia[] };
  brand?: string;
}

interface ZaraNextData {
  props?: {
    pageProps?: {
      productDetail?: ZaraProductDetail;
      product?: ZaraProductDetail;
      initialData?: {
        product?: ZaraProductDetail;
      };
    };
  };
}

const ZARA_CDN_BASE = 'https://static.zara.net';

/**
 * Resolve a Zara image path to a full hi-res URL.
 */
function resolveZaraImage(media: ZaraMedia): string {
  const raw = media.url ?? media.path ?? '';
  if (!raw) return '';

  const bumpWidth = (u: string) => u.replace(/([?&])w=\d+/g, '$1w=1920');

  if (raw.startsWith('http')) {
    return bumpWidth(raw);
  }
  if (raw.startsWith('//')) {
    return bumpWidth(`https:${raw}`);
  }
  const withBase = `${ZARA_CDN_BASE}${raw.startsWith('/') ? '' : '/'}${raw}`;
  return bumpWidth(withBase);
}

function zaraCentsToDecimal(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** Zara uses integer cents (4995) for major currencies; some payloads use decimal units. */
function zaraValueToDecimalString(price: ZaraPrice): string | null {
  const v = price.value;
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (!Number.isInteger(v)) return v.toFixed(2);
  if (Math.abs(v) >= 100) return zaraCentsToDecimal(v);
  return v.toFixed(2);
}

/**
 * og: / meta price when JSON-LD and `__NEXT_DATA__` are empty or blocked.
 */
async function scrapeZaraFromDom(page: Page): Promise<ScrapedProduct | null> {
  const raw = await page.evaluate(() => {
    const title =
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
        ?.trim() ||
      document
        .querySelector('meta[name="twitter:title"]')
        ?.getAttribute('content')
        ?.trim() ||
      document.querySelector('h1')?.textContent?.trim();
    if (!title) return null;

    let price: string | null =
      document
        .querySelector('meta[property="product:price:amount"]')
        ?.getAttribute('content') ||
      document
        .querySelector('meta[itemprop="price"]')
        ?.getAttribute('content') ||
      null;

    let currency =
      document
        .querySelector('meta[property="product:price:currency"]')
        ?.getAttribute('content') ||
      document
        .querySelector('meta[itemprop="priceCurrency"]')
        ?.getAttribute('content') ||
      'EUR';

    if (!price) {
      const body = document.body?.innerText ?? '';
      const m = body.match(/(\d+[.,]\d{2})\s*(EUR|USD|GBP)/i);
      if (m) {
        price = m[1].replace(',', '.');
        currency = m[2].toUpperCase();
      }
    }

    const og =
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content') || '';

    return { title, price, currency, og };
  });

  if (!raw?.title?.trim() || !raw.price) return null;
  const priceParsed = parsePriceToDecimalString(raw.price);
  if (!priceParsed) return null;

  const cleanTitle = raw.title.split('|')[0].trim();

  return {
    title: cleanTitle,
    price: priceParsed,
    currency: (raw.currency || 'EUR').toUpperCase().slice(0, 8),
    images: raw.og ? [raw.og] : [],
    brand: 'Zara',
    variants: [],
    availability: 'in_stock',
  };
}

/** String-aware `{...}` parse (Zara embeds large nested JSON; regex fallbacks break). */
function parseJsonObjectAt(s: string, braceStart: number): unknown | null {
  if (s[braceStart] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceStart; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(braceStart, i + 1)) as unknown;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function extractJsonAfterKey(script: string, key: string): unknown | null {
  const needle = `"${key}"`;
  let from = 0;
  while (from < script.length) {
    const ki = script.indexOf(needle, from);
    if (ki === -1) break;
    const colon = script.indexOf(':', ki + needle.length);
    if (colon === -1) break;
    let j = colon + 1;
    while (j < script.length && /\s/.test(script[j])) j++;
    if (script[j] === '{') return parseJsonObjectAt(script, j);
    from = ki + needle.length;
  }
  return null;
}

function extractAssignmentRhsObject(
  script: string,
  varPattern: RegExp,
): unknown | null {
  const m = script.match(varPattern);
  if (!m) return null;
  const start = m.index! + m[0].length;
  let j = start;
  while (j < script.length && /\s/.test(script[j])) j++;
  if (script[j] !== '{') return null;
  return parseJsonObjectAt(script, j);
}

function readZaraPriceObj(p: unknown): ZaraPrice | null {
  if (p == null) return null;
  if (typeof p === 'number' && !Number.isNaN(p)) {
    return { value: p, currency: 'EUR' };
  }
  if (typeof p !== 'object') return null;
  const z = p as Record<string, unknown>;
  if (typeof z.value === 'number') {
    const c = typeof z.currency === 'string' && z.currency ? z.currency : 'EUR';
    return { value: z.value, currency: c };
  }
  return null;
}

/**
 * Normalize Zara API variants: `name` vs `title`, `price` vs `price.min`, etc.
 */
function coerceToZaraProductDetail(raw: unknown): ZaraProductDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const nameRaw = o.name ?? o.title ?? o.productName;
  const name =
    typeof nameRaw === 'string'
      ? nameRaw.trim()
      : typeof nameRaw === 'number'
        ? String(nameRaw)
        : '';
  if (!name) return null;

  const saleP = readZaraPriceObj(o.salePrice);
  let priceP = readZaraPriceObj(o.price);
  const prRaw = o.price;
  if (
    priceP === null &&
    prRaw &&
    typeof prRaw === 'object' &&
    !Array.isArray(prRaw)
  ) {
    const minP = readZaraPriceObj((prRaw as { min?: unknown }).min);
    if (minP) priceP = minP;
  }
  const origP = readZaraPriceObj(o.originalPrice);

  const active = saleP ?? priceP ?? origP;
  if (!active) return null;

  const colors = Array.isArray(o.colors)
    ? (o.colors as ZaraColor[])
    : undefined;

  const listPrice: ZaraPrice = priceP ?? origP ?? saleP ?? active;

  return {
    name,
    description: typeof o.description === 'string' ? o.description : undefined,
    sectionName: typeof o.sectionName === 'string' ? o.sectionName : undefined,
    colors,
    price: listPrice,
    salePrice: saleP ?? undefined,
    originalPrice: origP ?? undefined,
    media: o.media as ZaraProductDetail['media'],
    brand: typeof o.brand === 'string' ? o.brand : undefined,
  };
}

function looksLikeZaraProductBlob(o: Record<string, unknown>): boolean {
  const title = o.name ?? o.title ?? o.productName;
  if (typeof title !== 'string' || !title.trim()) return false;
  const hasColors = Array.isArray(o.colors);
  const hasPrice =
    o.price != null ||
    o.salePrice != null ||
    o.originalPrice != null ||
    (typeof o.price === 'object' &&
      o.price !== null &&
      'min' in (o.price as object));
  return hasColors || hasPrice;
}

function deepFindProductDetail(
  node: unknown,
  depth = 0,
): ZaraProductDetail | null {
  if (depth > 35 || node == null) return null;
  if (typeof node !== 'object') return null;

  if (!Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if (looksLikeZaraProductBlob(o)) {
      const c = coerceToZaraProductDetail(o);
      if (c) return c;
    }
  }

  if (Array.isArray(node)) {
    for (const el of node) {
      const f = deepFindProductDetail(el, depth + 1);
      if (f) return f;
    }
    return null;
  }
  for (const v of Object.values(node)) {
    const f = deepFindProductDetail(v, depth + 1);
    if (f) return f;
  }
  return null;
}

function extractZaraProduct(root: unknown): ZaraProductDetail | null {
  if (!root || typeof root !== 'object') return null;
  const nd = root as ZaraNextData;
  const pp = nd.props?.pageProps;
  if (pp) {
    const direct =
      pp.productDetail ?? pp.product ?? pp.initialData?.product ?? null;
    const c = coerceToZaraProductDetail(direct);
    if (c) return c;
  }
  return deepFindProductDetail(root);
}

function tryParseZaraJsonSources(sources: string[]): ZaraProductDetail | null {
  for (const raw of sources) {
    const t = raw?.trim();
    if (!t || t.length < 20) continue;
    try {
      const parsed = JSON.parse(t) as unknown;
      const product = extractZaraProduct(parsed);
      if (product) return product;
    } catch {
      /* try next */
    }
  }
  return null;
}

function tryHydrationAndInlineScripts(
  scripts: string[],
): ZaraProductDetail | null {
  for (const txt of scripts) {
    if (!txt || txt.length < 50) continue;
    const staticObj = extractAssignmentRhsObject(
      txt,
      /__staticRouterHydrationData__\s*=\s*/,
    );
    if (staticObj) {
      const p = extractZaraProduct(staticObj);
      if (p) return p;
    }
    const pd = extractJsonAfterKey(txt, 'productDetail');
    const fromPd = coerceToZaraProductDetail(pd);
    if (fromPd) return fromPd;
  }
  return null;
}

/** Last resort when JSON bundles are empty or blocked (meta + JSON-LD only). */
function scrapedFromJsonLd(
  ldProduct: Record<string, unknown>,
  images: string[],
): ScrapedProduct | null {
  let name: unknown = ldProduct.name;
  if (typeof name !== 'string' || !name.trim()) {
    const graph = ldProduct['@graph'];
    if (Array.isArray(graph)) {
      for (const node of graph) {
        if (
          node &&
          typeof node === 'object' &&
          (node as { '@type'?: string })['@type'] === 'Product' &&
          typeof (node as { name?: string }).name === 'string'
        ) {
          name = (node as { name: string }).name;
          break;
        }
      }
    }
  }
  if (typeof name !== 'string' || !name.trim()) return null;

  const offers = ldProduct.offers;
  let offer: unknown = Array.isArray(offers) ? offers[0] : offers;
  if (!offer || typeof offer !== 'object') {
    const graph = ldProduct['@graph'];
    if (Array.isArray(graph)) {
      const prod = graph.find(
        (n) =>
          n &&
          typeof n === 'object' &&
          (n as { '@type'?: string })['@type'] === 'Product',
      ) as { offers?: unknown } | undefined;
      if (prod?.offers) {
        const off = prod.offers;
        offer = Array.isArray(off) ? off[0] : off;
      }
    }
  }
  if (!offer || typeof offer !== 'object') return null;
  const o = offer as Record<string, unknown>;
  let priceRaw: unknown = o.price;
  if (priceRaw == null && typeof o.priceSpecification === 'object') {
    const ps = o.priceSpecification as Record<string, unknown>;
    priceRaw = ps.price ?? ps.value;
  }
  const priceStr = parsePriceToDecimalString(priceRaw as string | number);
  if (!priceStr) return null;
  const currency =
    typeof o.priceCurrency === 'string' ? o.priceCurrency.toUpperCase() : 'USD';
  const img = ldProduct.image;
  const imgs = Array.isArray(img) ? img : img ? [img] : [];
  const merged = [...imgs, ...images].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('http'),
  );
  return {
    title: name.trim(),
    price: priceStr,
    currency,
    images: [...new Set(merged)].slice(0, 20),
    brand:
      typeof ldProduct.brand === 'object' && ldProduct.brand !== null
        ? String((ldProduct.brand as { name?: string }).name ?? 'Zara')
        : typeof ldProduct.brand === 'string'
          ? ldProduct.brand
          : 'Zara',
    description:
      typeof ldProduct.description === 'string'
        ? ldProduct.description
        : undefined,
    variants: [],
    availability: 'in_stock',
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Writes `zara.html` at repo root: scraped JSON + raw HTML snapshot (debug).
 */
async function writeZaraHtmlDebugFile(opts: {
  url: string;
  page: Page;
  scraped?: ScrapedProduct;
  note?: string;
}): Promise<void> {
  const { url, page, scraped, note } = opts;
  let htmlSnap = '';
  try {
    htmlSnap = await page.content();
    if (htmlSnap.length > 800_000) {
      htmlSnap = `${htmlSnap.slice(0, 800_000)}\n<!-- truncated -->`;
    }
  } catch {
    htmlSnap = '(could not read page content)';
  }
  const meta = {
    scrapedAt: new Date().toISOString(),
    url,
    note: note ?? '',
    scraped: scraped ?? null,
  };
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Zara scrape debug</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; color: #111; }
    pre { background: #f4f4f4; padding: 1rem; overflow: auto; font-size: 12px; }
    pre#json { max-height: 42vh; }
    pre#html { max-height: 55vh; }
    h2 { margin-top: 1.5rem; font-size: 1rem; }
  </style>
</head>
<body>
  <h1>Zara scrape debug</h1>
  <h2>Scraped result (JSON)</h2>
  <pre id="json">${escapeHtml(JSON.stringify(meta, null, 2))}</pre>
  <h2>Raw page HTML (Playwright snapshot)</h2>
  <pre id="html">${escapeHtml(htmlSnap)}</pre>
</body>
</html>`;
  await writeFile(join(process.cwd(), 'zara.html'), doc, 'utf-8');
}

function resolveSelectedColor(colors: ZaraColor[], url: string): ZaraColor {
  const flagged = colors.find((c) => c.selected);
  if (flagged) return flagged;

  try {
    const v1 = new URL(url).searchParams.get('v1');
    if (v1) {
      const matched = colors.find((c) =>
        c.sizes?.some((s) => s.sku?.startsWith(v1) || s.sku === v1),
      );
      if (matched) return matched;
    }
  } catch {
    /* bad URL */
  }

  return colors[0];
}

@Injectable()
export class ZaraAdapter implements ScraperAdapter {
  readonly source = ProductSource.ZARA;
  private readonly logger = new Logger(ZaraAdapter.name);

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      contextOverrides: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        locale: 'en-US',
        extraHTTPHeaders: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 60_000 },
    });

    let lastResult: ScrapedProduct | undefined;
    let lastNote = '';
    const done = (r: ScrapedProduct, note: string): ScrapedProduct => {
      lastResult = r;
      lastNote = note;
      return r;
    };

    try {

      await page
        .waitForFunction(
          () =>
            (document.querySelector('script#__NEXT_DATA__')?.textContent
              ?.length ?? 0) > 80,
          { timeout: 25_000 },
        )
        .catch(() => undefined);

      await page.evaluate(() => window.scrollTo(0, 500)).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 800));

      const bundle = await page.evaluate(() => {
        const nextText =
          document.querySelector('script#__NEXT_DATA__')?.textContent?.trim() ??
          '';
        const inlineScripts = Array.from(
          document.querySelectorAll('script:not([src])'),
        ).map((s) => s.textContent ?? '');

        let ld: Record<string, unknown> | null = null;
        const ogImages: string[] = [];
        const ogImg =
          document
            .querySelector('meta[property="og:image"]')
            ?.getAttribute('content') || '';
        if (ogImg) ogImages.push(ogImg);

        for (const s of document.querySelectorAll(
          'script[type="application/ld+json"]',
        )) {
          try {
            const j = JSON.parse(s.textContent || '{}') as unknown;
            const nodes = Array.isArray(j) ? j : [j];
            for (const node of nodes) {
              if (
                node &&
                typeof node === 'object' &&
                (node as { '@type'?: string })['@type'] === 'Product'
              ) {
                ld = node as Record<string, unknown>;
                break;
              }
            }
          } catch {
            /* skip */
          }
          if (ld) break;
        }

        return { nextText, inlineScripts, ld, ogImages };
      });

      const scriptSources: string[] = [];
      if (bundle.nextText) scriptSources.push(bundle.nextText);

      let product = tryParseZaraJsonSources(scriptSources);
      if (!product) {
        product = tryHydrationAndInlineScripts(bundle.inlineScripts);
      }

      if (!product && bundle.ld) {
        const fallback = scrapedFromJsonLd(bundle.ld, bundle.ogImages);
        if (fallback) {
          this.logger.warn(
            `ZaraAdapter: using JSON-LD fallback (limited variants) at ${url}`,
          );
          return done(fallback, 'json-ld-fallback');
        }
      }

      if (!product || !product.name) {
        const domFb = await scrapeZaraFromDom(page);
        if (domFb) {
          this.logger.warn(
            `ZaraAdapter: using DOM/meta fallback (limited variants) at ${url}`,
          );
          return done(domFb, 'dom-meta-fallback');
        }
        this.logger.warn(
          `ZaraAdapter: could not extract product from JSON at ${url}`,
        );
        return done(
          await this.generic.scrape(url),
          'generic-fallback-no-product-json',
        );
      }

      const colors = product.colors ?? [];
      const selectedColor = colors.length
        ? resolveSelectedColor(colors, url)
        : null;

      const activePriceObj = product.salePrice ?? product.price ?? null;
      const wasPriceObj = product.salePrice
        ? (product.originalPrice ?? product.price)
        : null;

      const currency = (
        activePriceObj?.currency ??
        product.price?.currency ??
        'USD'
      ).toUpperCase();

      const priceStr = activePriceObj
        ? zaraValueToDecimalString(activePriceObj)
        : null;

      const comparePriceStr =
        wasPriceObj != null
          ? (zaraValueToDecimalString(wasPriceObj) ?? undefined)
          : undefined;

      if (!priceStr) {
        this.logger.warn(`ZaraAdapter: no price found at ${url}`);
        const domFb = await scrapeZaraFromDom(page);
        if (domFb) {
          this.logger.warn(
            `ZaraAdapter: using DOM/meta fallback after missing JSON price at ${url}`,
          );
          return done(domFb, 'dom-meta-fallback-missing-json-price');
        }
        return done(
          await this.generic.scrape(url),
          'generic-fallback-no-product-price',
        );
      }

      const allImages: string[] = [];
      const seen = new Set<string>();

      const addImages = (mediaArr?: ZaraMedia[]) => {
        for (const m of mediaArr ?? []) {
          if (m.kind === 'video') continue;
          const resolved = resolveZaraImage(m);
          if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            allImages.push(resolved);
          }
        }
      };

      addImages(selectedColor?.media?.images);
      addImages(product.media?.images);
      for (const color of colors) {
        if (color === selectedColor) continue;
        addImages(color.media?.images);
        if (allImages.length >= 20) break;
      }

      const variants: ScrapedProduct['variants'] = [];

      if (colors.length > 1) {
        variants.push({
          name: 'Color',
          options: colors
            .map((c) => c.name ?? '')
            .filter(Boolean)
            .filter((c, i, arr) => arr.indexOf(c) === i),
        });
      }

      const sizes = selectedColor?.sizes ?? [];
      const availableSizes = sizes.filter(
        (s) => s.availability !== 'out_of_stock',
      );

      if (sizes.length) {
        variants.push({
          name: 'Size',
          options: sizes.map((s) => s.name ?? '').filter(Boolean),
        });
      }

      const configurationPrices =
        colors.length > 1
          ? colors.map((c) => {
              const name = c.name ?? 'Color';
              return {
                label: name,
                originalPrice: priceStr,
                variantAxis: 'Color',
                optionValue: name,
                available:
                  c.sizes?.some((s) => s.availability !== 'out_of_stock') ??
                  true,
                metadata: { source: 'zara' },
              };
            })
          : undefined;

      const inStock = availableSizes.length > 0 || sizes.length === 0;
      const availability = inStock ? 'in_stock' : 'out_of_stock';

      const descParts: string[] = [];
      if (product.description) descParts.push(product.description.trim());
      if (product.sectionName)
        descParts.push(`Section: ${product.sectionName}`);
      if (selectedColor?.name)
        descParts.push(`Selected color: ${selectedColor.name}`);

      return done(
        {
          title: product.name.trim(),
          price: priceStr,
          currency,
          compareAtPrice: comparePriceStr,
          images: allImages.slice(0, 20),
          brand: product.brand ?? 'Zara',
          description: descParts.join('\n\n') || undefined,
          variants,
          configurationPrices,
          availability,
        },
        'zara-next-data-full',
      );
    } catch (err) {
      this.logger.error(
        `ZaraAdapter: failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      const g = await this.generic.scrape(url);
      lastResult = g;
      lastNote = `catch:${(err as Error).message} -> generic`;
      return g;
    } finally {
      if (process.env.ZARA_DEBUG === '1' && page) {
        await writeZaraHtmlDebugFile({
          url,
          page,
          scraped: lastResult,
          note: lastNote || 'no-result',
        }).catch(() => undefined);
      }
      await context.close();
    }
  }
}
