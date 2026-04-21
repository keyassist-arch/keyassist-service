import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { ProductConfigurationPrice } from '../../products/entities/product.entity';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

interface SfccPrice {
  sales?: { value: number; formatted?: string; currency?: string };
  list?: { value: number; formatted?: string; currency?: string } | null;
}

interface SfccVariationAttribute {
  id: string;
  displayName: string;
  values?: Array<{
    id: string;
    displayValue: string;
    selectable?: boolean;
    selected?: boolean;
    url?: string;
  }>;
}

interface SfccImage {
  url?: string;
  absURL?: string;
  src?: string;
  title?: string;
}

interface SfccProduct {
  productName?: string;
  productType?: string;
  brand?: string;
  shortDescription?: string;
  longDescription?: string;
  price?: SfccPrice;
  colorVariations?: Array<{
    name?: string;
    color?: { displayValue?: string; value?: string };
    url?: string;
    selected?: boolean;
    images?: { large?: SfccImage[]; medium?: SfccImage[] };
  }>;
  images?: {
    large?: SfccImage[];
    medium?: SfccImage[];
    small?: SfccImage[];
  };
  variationAttributes?: SfccVariationAttribute[];
  availability?: {
    messages?: string[];
    inStock?: boolean;
  };
  id?: string;
  masterId?: string;
}

interface ConverseStateShape {
  product?: SfccProduct;
  pdpMain?: { product?: SfccProduct };
  productCache?: Record<string, SfccProduct>;
}

function extractSfccProduct(
  stateJson: string,
  schemaJson: string,
): SfccProduct | null {
  if (stateJson) {
    try {
      const state = JSON.parse(stateJson) as ConverseStateShape;
      const p =
        state.product ??
        state.pdpMain?.product ??
        (state.productCache
          ? Object.values(state.productCache)[0]
          : null);
      if (p?.productName) return p;
    } catch {
      /* malformed */
    }
  }

  if (schemaJson) {
    try {
      const schema = JSON.parse(schemaJson) as SfccProduct;
      if (schema?.productName) return schema;
    } catch {
      /* malformed */
    }
  }

  return null;
}

function sfccImageUrl(img: SfccImage): string {
  return (img.absURL ?? img.url ?? img.src ?? '').trim();
}

function extractSfccImages(
  images: SfccProduct['images'],
  colorVariations?: SfccProduct['colorVariations'],
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const add = (img: SfccImage) => {
    const u = sfccImageUrl(img);
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  for (const img of images?.large ?? []) add(img);
  for (const img of images?.medium ?? []) add(img);

  for (const cv of colorVariations ?? []) {
    for (const img of cv.images?.large ?? []) add(img);
    for (const img of cv.images?.medium ?? []) add(img);
    if (urls.length >= 20) break;
  }

  return urls.slice(0, 20);
}

/** Magento 2 configurable `jsonConfig` (swatch-renderer), e.g. converse.co.za (Vaimo). */
interface MagentoJsonAttrOption {
  id: string;
  label: string;
  products?: string[];
}

interface MagentoJsonAttribute {
  id: string;
  code: string;
  label: string;
  options: MagentoJsonAttrOption[];
  position?: string;
}

interface MagentoTierPrice {
  amount?: number;
}

interface MagentoOptionPriceRow {
  finalPrice?: { amount: number };
  oldPrice?: { amount: number };
  baseOldPrice?: { amount: number };
  tierPrices?: MagentoTierPrice[];
}

interface MagentoJsonConfig {
  attributes: Record<string, MagentoJsonAttribute>;
  optionPrices: Record<string, MagentoOptionPriceRow>;
  index: Record<string, Record<string, string>>;
  sku?: Record<string, string>;
  child_attributes?: Record<
    string,
    { stock_quantity?: number; style_code?: string }
  >;
  salable?: Record<string, unknown> | unknown[];
  images?: Record<string, unknown[]>;
}

interface MagentoDomSnapshot {
  title: string;
  priceAmountAttr: string;
  currencyMeta: string;
  imageUrls: string[];
  overviewText: string;
  genderOrSubdesc: string;
  parentInStock: boolean;
}

/**
 * Parse a JSON object starting at `{` with string-aware brace matching.
 */
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

function extractMagentoJsonConfig(scriptText: string): MagentoJsonConfig | null {
  const key = '"jsonConfig"';
  let from = 0;
  while (from < scriptText.length) {
    const ki = scriptText.indexOf(key, from);
    if (ki === -1) break;
    const colon = scriptText.indexOf(':', ki + key.length);
    if (colon === -1) break;
    let j = colon + 1;
    while (j < scriptText.length && /\s/.test(scriptText[j])) j++;
    if (scriptText[j] !== '{') {
      from = ki + key.length;
      continue;
    }
    const parsed = parseJsonObjectAt(scriptText, j);
    if (parsed && typeof parsed === 'object' && parsed !== null) {
      const cfg = parsed as Record<string, unknown>;
      if (
        cfg.attributes &&
        cfg.optionPrices &&
        typeof cfg.optionPrices === 'object'
      ) {
        return parsed as MagentoJsonConfig;
      }
    }
    from = ki + key.length;
  }
  return null;
}

function optionLabelForAttribute(
  attr: MagentoJsonAttribute | undefined,
  optionId: string,
): string | null {
  if (!attr?.options?.length) return null;
  const hit = attr.options.find((o) => o.id === optionId);
  return hit?.label?.trim() || null;
}

/** PDP order: Color before Size before other swatches (matches typical Magento UX). */
function magentoAttributeSortKey(code: string): number {
  const c = code.toLowerCase();
  if (c === 'color') return 0;
  if (c === 'size') return 1;
  return 10;
}

function sortedMagentoAttrEntries(
  attributes: Record<string, MagentoJsonAttribute> | undefined,
): [string, MagentoJsonAttribute][] {
  return Object.entries(attributes ?? {}).sort((a, b) => {
    const ca = magentoAttributeSortKey(a[1].code ?? '');
    const cb = magentoAttributeSortKey(b[1].code ?? '');
    if (ca !== cb) return ca - cb;
    const pa = Number(a[1].position ?? 0);
    const pb = Number(b[1].position ?? 0);
    if (pa !== pb) return pa - pb;
    return a[0].localeCompare(b[0]);
  });
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMagentoScrapedProduct(
  cfg: MagentoJsonConfig,
  dom: MagentoDomSnapshot,
  ldProduct: Record<string, unknown> | null,
): ScrapedProduct | null {
  const title = dom.title.trim();
  if (!title) return null;

  let priceStr =
    parsePriceToDecimalString(dom.priceAmountAttr) ??
    (ldProduct?.offers
      ? (() => {
          const offers = Array.isArray(ldProduct.offers)
            ? ldProduct.offers[0]
            : ldProduct.offers;
          if (offers && typeof offers === 'object') {
            const o = offers as Record<string, unknown>;
            if (o.price != null)
              return parsePriceToDecimalString(o.price as string | number);
          }
          return null;
        })()
      : null);

  if (!priceStr && cfg.optionPrices) {
    const firstPid = Object.keys(cfg.optionPrices)[0];
    const fp = firstPid
      ? cfg.optionPrices[firstPid]?.finalPrice?.amount
      : undefined;
    if (fp != null) priceStr = parsePriceToDecimalString(fp);
  }

  if (!priceStr) return null;

  let currency = (dom.currencyMeta || 'USD').toUpperCase();
  if (ldProduct?.offers) {
    const offers = Array.isArray(ldProduct.offers)
      ? ldProduct.offers[0]
      : ldProduct.offers;
    if (offers && typeof offers === 'object') {
      const o = offers as Record<string, unknown>;
      if (typeof o.priceCurrency === 'string')
        currency = o.priceCurrency.toUpperCase();
    }
  }

  const attrEntries = sortedMagentoAttrEntries(cfg.attributes);

  const optionLabelCache = new Map<string, string>();

  const resolveLabel = (attrId: string, optionId: string): string => {
    const k = `${attrId}:${optionId}`;
    if (optionLabelCache.has(k)) return optionLabelCache.get(k)!;
    const attr = cfg.attributes[attrId];
    let label = optionLabelForAttribute(attr, optionId);
    if (!label) {
      label = `${attr?.label ?? 'Option'} #${optionId}`;
    }
    optionLabelCache.set(k, label);
    return label;
  };

  const variants: ScrapedProduct['variants'] = [];
  for (const [, attr] of attrEntries) {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const opt of attr.options ?? []) {
      const lab = opt.label?.trim();
      if (lab && !seen.has(lab)) {
        seen.add(lab);
        ordered.push(lab);
      }
    }
    const extras: string[] = [];
    for (const pid of Object.keys(cfg.optionPrices ?? {})) {
      const idx = cfg.index?.[pid];
      if (!idx) continue;
      const oid = idx[attr.id];
      if (!oid) continue;
      const lab = resolveLabel(attr.id, oid);
      if (!seen.has(lab)) {
        seen.add(lab);
        extras.push(lab);
      }
    }
    extras.sort((a, b) => a.localeCompare(b));
    const options = [...ordered, ...extras];
    if (options.length) {
      variants.push({ name: attr.label || attr.code, options });
    }
  }

  const configurationPrices: ProductConfigurationPrice[] = [];
  const productIds = Object.keys(cfg.optionPrices ?? {}).sort(
    (a, b) => Number(a) - Number(b),
  );

  let globalCompareAmount: number | undefined;
  for (const pid of productIds) {
    const row = cfg.optionPrices[pid];
    const finalAmt = row?.finalPrice?.amount;
    const oldAmt = row?.oldPrice?.amount;
    if (finalAmt == null) continue;
    const originalPrice = parsePriceToDecimalString(finalAmt);
    if (!originalPrice) continue;

    if (oldAmt != null && oldAmt > finalAmt) {
      globalCompareAmount =
        globalCompareAmount == null
          ? oldAmt
          : Math.max(globalCompareAmount, oldAmt);
    }

    const idx = cfg.index?.[pid] ?? {};
    const axisLabels: string[] = [];
    const metaAxes: Record<string, string> = {};
    const selectionByVariantName: Record<string, string> = {};
    for (const [, attr] of attrEntries) {
      const optId = idx[attr.id];
      if (optId == null) continue;
      const lab = resolveLabel(attr.id, optId);
      const codeKey = (attr.code ?? attr.id).toLowerCase();
      metaAxes[codeKey] = lab;
      const variantAxisName = (attr.label || attr.code || codeKey).trim();
      selectionByVariantName[variantAxisName] = lab;
      axisLabels.push(lab);
    }

    const sizeAttr = attrEntries.find(
      ([, a]) => a.code?.toLowerCase() === 'size',
    );
    const sizeAxisId = sizeAttr?.[0];
    const sizeLabel =
      sizeAxisId != null ? idx[sizeAxisId] : undefined;
    const variantAxis = sizeAttr?.[1]?.label ?? 'Size';
    const optionValue =
      sizeAxisId != null && sizeLabel != null
        ? resolveLabel(sizeAxisId, sizeLabel)
        : axisLabels.join(' / ');

    const child = cfg.child_attributes?.[pid];
    const stockQ = child?.stock_quantity;
    let available = dom.parentInStock;
    if (typeof stockQ === 'number' && stockQ > 0) available = true;
    if (typeof stockQ === 'number' && stockQ < 0) available = false;

    if (cfg.salable && !Array.isArray(cfg.salable)) {
      const sal = (cfg.salable as Record<string, unknown>)[pid];
      if (sal === false) available = false;
    }

    const sku = cfg.sku?.[pid];
    const label = axisLabels.length ? axisLabels.join(' · ') : `SKU ${sku ?? pid}`;
    const displayLabel = `${label} — ${currency} ${originalPrice}`;

    const colorFromAxes = metaAxes.color;
    const sizeFromAxes = metaAxes.size;

    configurationPrices.push({
      label,
      originalPrice,
      sku,
      variantAxis,
      optionValue,
      currency,
      available,
      displayLabel,
      metadata: {
        source: 'converse-magento',
        magentoChildProductId: pid,
        axes: metaAxes,
        /** Keys match `variants[].name` (e.g. Color, Size) for multi-axis row matching. */
        selection: selectionByVariantName,
        ...(colorFromAxes != null ? { color: colorFromAxes } : {}),
        ...(sizeFromAxes != null ? { size: sizeFromAxes } : {}),
      },
    });
  }

  const seen = new Set<string>();
  const images = dom.imageUrls.filter((u) => {
    if (!u || u.startsWith('data:')) return false;
    if (u.includes('vaimo_badges')) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  const descParts: string[] = [];
  if (dom.genderOrSubdesc.trim())
    descParts.push(dom.genderOrSubdesc.trim());
  if (dom.overviewText.trim()) descParts.push(dom.overviewText.trim());
  if (ldProduct?.description && typeof ldProduct.description === 'string') {
    const stripped = stripHtmlToText(ldProduct.description);
    if (stripped.length > 40) descParts.push(stripped);
  }

  const brand =
    ldProduct?.brand &&
    typeof ldProduct.brand === 'object' &&
    (ldProduct.brand as { name?: string }).name
      ? String((ldProduct.brand as { name?: string }).name)
      : 'Converse';

  const availability = dom.parentInStock ? 'in_stock' : 'out_of_stock';

  const globalCompare =
    globalCompareAmount != null
      ? parsePriceToDecimalString(globalCompareAmount) ?? undefined
      : undefined;

  return {
    title,
    price: priceStr,
    currency,
    compareAtPrice: globalCompare,
    images: images.length ? images.slice(0, 30) : [],
    brand,
    description: descParts.join('\n\n') || undefined,
    variants,
    configurationPrices:
      configurationPrices.length > 0 ? configurationPrices : undefined,
    availability,
  };
}

@Injectable()
export class ConverseAdapter implements ScraperAdapter {
  readonly source = ProductSource.CONVERSE;
  private readonly logger = new Logger(ConverseAdapter.name);

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
    }, url);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      await page
        .waitForSelector(
          'script#product-schema, h1.pdp-header__name, [data-test="product-name"], h1.page-title',
          { timeout: 15_000 },
        )
        .catch(() => undefined);

      await new Promise((r) => setTimeout(r, 600));

      const {
        stateJson,
        schemaJson,
        ldJson,
        fallbackImages,
        swatchScript,
        magentoTitle,
        magentoPriceAmount,
        magentoCurrencyMeta,
        magentoImages,
        magentoOverview,
        magentoGender,
        magentoInStock,
      } = await page.evaluate(() => {
        let stateJsonInner = '';
        const scripts = Array.from(
          document.querySelectorAll('script:not([src])'),
        );
        for (const s of scripts) {
          const txt = s.textContent ?? '';
          if (txt.includes('window.__STATE__')) {
            const m = txt.match(
              /window\.__STATE__\s*=\s*(\{[\s\S]+?\})\s*(?:;|<\/script>)/,
            );
            if (m) {
              stateJsonInner = m[1];
              break;
            }
          }
        }

        const schemaJsonInner =
          document.querySelector('script#product-schema')?.textContent ?? '';

        let ldJsonInner = '';
        for (const s of document.querySelectorAll(
          'script[type="application/ld+json"]',
        )) {
          const txt = s.textContent ?? '';
          if (txt.includes('"Product"')) {
            ldJsonInner = txt;
            break;
          }
        }

        let swatchScriptInner = '';
        for (const s of document.querySelectorAll('script')) {
          const txt = s.textContent ?? '';
          if (
            txt.includes('Magento_Swatches/js/swatch-renderer') &&
            txt.includes('"jsonConfig"')
          ) {
            swatchScriptInner = txt;
            break;
          }
        }

        const magentoTitleInner =
          document
            .querySelector('h1.page-title span.base')
            ?.textContent?.trim() ??
          document.querySelector('h1.page-title')?.textContent?.trim() ??
          '';

        const magentoPriceAmountInner =
          document
            .querySelector('[data-price-type="finalPrice"][data-price-amount]')
            ?.getAttribute('data-price-amount') ?? '';

        const magentoCurrencyMetaInner =
          document
            .querySelector('meta[itemprop="priceCurrency"]')
            ?.getAttribute('content') ?? '';

        const magentoImagesInner: string[] = [];
        const magentoSeen = new Set<string>();
        for (const img of document.querySelectorAll(
          '.custom-gallery--container img[src], .gallery-placeholder img[src], .hidden-pwp-gallery img[src], .gallery-placeholder__image[src]',
        )) {
          const el = img as HTMLImageElement;
          const src = el.src || el.getAttribute('data-src') || '';
          if (src && !src.startsWith('data:') && !magentoSeen.has(src)) {
            magentoSeen.add(src);
            magentoImagesInner.push(src);
          }
        }

        const magentoOverviewInner =
          document
            .querySelector('.product.attribute.overview .value')
            ?.textContent?.trim() ?? '';

        const magentoGenderInner =
          document.querySelector('.product.attribute.gender')?.textContent?.trim() ??
          '';

        const magentoInStockInner = !!document.querySelector(
          '.product-info-main .stock.available',
        );

        const fallbackImagesInner: string[] = [];
        const seen = new Set<string>();
        for (const img of document.querySelectorAll(
          '.pdp-gallery img, .product-images img, [data-test="product-image"] img, .custom-gallery--container img, .gallery-placeholder img, .gallery-placeholder__image',
        )) {
          const src =
            (img as HTMLImageElement).src ||
            img.getAttribute('data-src') ||
            '';
          if (src && !src.startsWith('data:') && !seen.has(src)) {
            seen.add(src);
            fallbackImagesInner.push(src);
          }
        }

        return {
          stateJson: stateJsonInner,
          schemaJson: schemaJsonInner,
          ldJson: ldJsonInner,
          fallbackImages: fallbackImagesInner,
          swatchScript: swatchScriptInner,
          magentoTitle: magentoTitleInner,
          magentoPriceAmount: magentoPriceAmountInner,
          magentoCurrencyMeta: magentoCurrencyMetaInner,
          magentoImages: magentoImagesInner,
          magentoOverview: magentoOverviewInner,
          magentoGender: magentoGenderInner,
          magentoInStock: magentoInStockInner,
        };
      });

      const product = extractSfccProduct(stateJson, schemaJson);

      let priceStr: string | null = null;
      let comparePriceStr: string | undefined;
      let currency = 'USD';

      if (product?.price) {
        const sales = product.price.sales;
        const list = product.price.list;

        if (sales?.value != null) {
          priceStr = parsePriceToDecimalString(sales.value);
          currency = (sales.currency ?? 'USD').toUpperCase();
        }
        if (
          list?.value != null &&
          priceStr &&
          list.value > parseFloat(priceStr)
        ) {
          comparePriceStr = parsePriceToDecimalString(list.value) ?? undefined;
        }
      }

      if (!priceStr && ldJson) {
        try {
          const ld = JSON.parse(ldJson) as Record<string, unknown>;
          const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
          if (offers && typeof offers === 'object') {
            const o = offers as Record<string, unknown>;
            if (o.price != null)
              priceStr = parsePriceToDecimalString(o.price as string | number);
            if (typeof o.priceCurrency === 'string')
              currency = o.priceCurrency.toUpperCase();
          }
        } catch {
          /* malformed */
        }
      }

      const sfccTitle = product?.productName?.trim() ?? '';

      if (sfccTitle && priceStr) {
        const images = product
          ? extractSfccImages(product.images, product.colorVariations)
          : fallbackImages.slice(0, 20);

        const finalImages = images.length ? images : fallbackImages.slice(0, 20);

        const variants: ScrapedProduct['variants'] = [];

        const sfccAxisOrder = (name: string): number => {
          const n = name.toLowerCase();
          if (n === 'color') return 0;
          if (n === 'size') return 1;
          return 10;
        };
        const sortedVariationAttrs = [
          ...(product?.variationAttributes ?? []),
        ].sort(
          (a, b) =>
            sfccAxisOrder(a.displayName ?? '') -
            sfccAxisOrder(b.displayName ?? ''),
        );

        for (const attr of sortedVariationAttrs) {
          const options = (attr.values ?? [])
            .map((v) => v.displayValue)
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i);

          if (options.length) {
            variants.push({ name: attr.displayName, options });
          }
        }

        const colorOptionsFromVariations = product?.colorVariations?.length
          ? product.colorVariations
              .map((c) => c.color?.displayValue ?? c.name ?? '')
              .map((s) => String(s).trim())
              .filter(Boolean)
              .filter((v, i, arr) => arr.indexOf(v) === i)
          : [];

        if (!variants.length && colorOptionsFromVariations.length) {
          variants.push({
            name: 'Color',
            options: colorOptionsFromVariations,
          });
        } else if (
          variants.length > 0 &&
          !variants.some((v) => v.name.toLowerCase() === 'color') &&
          colorOptionsFromVariations.length
        ) {
          variants.unshift({
            name: 'Color',
            options: colorOptionsFromVariations,
          });
        }

        const configurationPrices =
          product?.colorVariations && product.colorVariations.length > 1
            ? product.colorVariations.map((cv) => {
                const label = cv.color?.displayValue ?? cv.name ?? 'Color';
                return {
                  label,
                  originalPrice: priceStr!,
                  variantAxis: 'Color',
                  optionValue: label,
                  available: true,
                  metadata: {
                    source: 'converse',
                    selection: { Color: label },
                  },
                };
              })
            : undefined;

        const inStock = product?.availability?.inStock !== false;
        const availability = inStock ? 'in_stock' : 'out_of_stock';

        const descParts: string[] = [];
        if (product?.shortDescription)
          descParts.push(product.shortDescription.trim());
        if (
          product?.longDescription &&
          product.longDescription !== product.shortDescription
        )
          descParts.push(product.longDescription.trim());

        return {
          title: sfccTitle,
          price: priceStr,
          currency,
          compareAtPrice: comparePriceStr,
          images: finalImages,
          brand: product?.brand ?? 'Converse',
          description: descParts.join('\n\n') || undefined,
          variants,
          configurationPrices,
          availability,
        };
      }

      const magentoCfg = extractMagentoJsonConfig(swatchScript);
      if (magentoCfg) {
        let ldProduct: Record<string, unknown> | null = null;
        if (ldJson) {
          try {
            ldProduct = JSON.parse(ldJson) as Record<string, unknown>;
          } catch {
            ldProduct = null;
          }
        }
        const dom: MagentoDomSnapshot = {
          title: magentoTitle,
          priceAmountAttr: magentoPriceAmount,
          currencyMeta: magentoCurrencyMeta,
          imageUrls:
            magentoImages.length > 0 ? magentoImages : fallbackImages,
          overviewText: magentoOverview,
          genderOrSubdesc: magentoGender,
          parentInStock: magentoInStock,
        };
        const magento = buildMagentoScrapedProduct(
          magentoCfg,
          dom,
          ldProduct,
        );
        if (magento) return magento;
      }

      if (!sfccTitle && !priceStr) {
        this.logger.warn(`ConverseAdapter: no product data at ${url}`);
        return this.generic.scrape(url);
      }

      if (!priceStr) {
        this.logger.warn(
          `ConverseAdapter: no price at ${url} — falling back to generic`,
        );
        return this.generic.scrape(url);
      }

      this.logger.warn(`ConverseAdapter: no title at ${url}`);
      return this.generic.scrape(url);
    } catch (err) {
      this.logger.error(
        `ConverseAdapter: failed for ${url} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.generic.scrape(url);
    } finally {
      await context.close();
    }
  }
}
