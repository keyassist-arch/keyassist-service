import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

type RawEbayData = {
  title?: string;
  description?: string;
  brand?: string;
  currency?: string;
  /** Price from the JSON-LD offer whose URL matches the iid query param (exact match). */
  ldPriceMatched?: string;
  /** Price from offers[0] — reliable on single-listing /itm/ pages. */
  ldPriceFallback?: string;
  /** DOM microdata price — least reliable, can be an auction current bid. */
  domPrice?: string;
  /** Was/list/original price from offer.priceSpecification or DOM strikethrough. */
  listPrice?: string;
  /** Savings percentage label, e.g. "60% off". */
  discountPercent?: string;
  /** Shipping cost from offer.shippingDetails[0].shippingRate.value. */
  shippingCost?: string;
  images: string[];
  conditionLabel?: string;
};

// ─── shared JSON-LD helpers ──────────────────────────────────────────────────

function isProductType(t: unknown): boolean {
  return (
    t === 'Product' ||
    t === 'product' ||
    (Array.isArray(t) && t.some((x) => String(x).toLowerCase() === 'product'))
  );
}

function findProductNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (isProductType(obj['@type'])) return obj;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findProductNode(item);
        if (found) return found;
      }
    } else {
      const found = findProductNode(value);
      if (found) return found;
    }
  }
  return null;
}

/** Convert schema.org condition URLs to human labels, e.g. "https://schema.org/RefurbishedCondition" → "Refurbished". */
function normaliseEbayCondition(raw: string): string {
  const map: Record<string, string> = {
    NewCondition: 'New',
    UsedCondition: 'Used',
    RefurbishedCondition: 'Refurbished',
    DamagedCondition: 'Damaged',
    OpenBoxCondition: 'Open Box',
  };
  const key = raw.split('/').pop() ?? raw;
  return map[key] ?? key.replace(/Condition$/, '').replace(/([A-Z])/g, ' $1').trim();
}

/** Parse the JSON-LD `offers` list and populate price/currency/condition fields. */
function applyOffers(
  offerList: Record<string, unknown>[],
  iid: string | null,
  result: RawEbayData,
): void {
  let matchedOffer: Record<string, unknown> | null = null;
  if (iid) {
    matchedOffer =
      offerList.find((o) => {
        const offerUrl = String(o.url ?? '');
        try {
          return new URL(offerUrl).searchParams.get('iid') === iid;
        } catch {
          return offerUrl.includes(`iid=${iid}`);
        }
      }) ?? null;
  }

  const activeOffer = matchedOffer ?? (offerList.length > 0 ? offerList[0] : null);
  if (!activeOffer) return;

  if (matchedOffer) {
    if (matchedOffer.price != null) result.ldPriceMatched = String(matchedOffer.price);
    if (matchedOffer.priceCurrency != null) result.currency = String(matchedOffer.priceCurrency);
    if (matchedOffer.itemCondition != null)
      result.conditionLabel = normaliseEbayCondition(String(matchedOffer.itemCondition));
  } else {
    const first = offerList[0];
    if (first.price != null) result.ldPriceFallback = String(first.price);
    if (!result.currency && first.priceCurrency != null) result.currency = String(first.priceCurrency);
    if (!result.conditionLabel && first.itemCondition != null)
      result.conditionLabel = normaliseEbayCondition(String(first.itemCondition));
  }

  // priceSpecification holds the was/list price (eBay labels it "List Price").
  const ps = activeOffer.priceSpecification as Record<string, unknown> | undefined;
  if (ps && typeof ps === 'object' && ps.price != null) {
    const psName = String(ps.name ?? '').toLowerCase();
    if (psName.includes('list') || psName.includes('was') || psName.includes('original')) {
      result.listPrice = String(ps.price);
    }
  }

  // Shipping cost from first shippingDetails entry.
  const shippingDetails = activeOffer.shippingDetails;
  const shipping = Array.isArray(shippingDetails)
    ? (shippingDetails as Record<string, unknown>[])[0]
    : (shippingDetails as Record<string, unknown> | undefined);
  const shippingRate = shipping?.shippingRate as Record<string, unknown> | undefined;
  if (shippingRate?.value != null) result.shippingCost = String(shippingRate.value);
}

// ─── server-side HTML parser (used by the scrape.do path) ────────────────────

function parseEbayHtml(html: string, iid: string | null): RawEbayData | null {
  const result: RawEbayData = { images: [] };

  // JSON-LD blocks
  const jsonLdNodes: Record<string, unknown>[] = [];
  // eBay omits quotes around the type attribute value: type=application/ld+json
  const jsonLdRe = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        if (node && typeof node === 'object') jsonLdNodes.push(node as Record<string, unknown>);
      }
    } catch { /* ignore */ }
  }

  const productNode = jsonLdNodes.map(findProductNode).find(Boolean) ?? null;
  if (productNode) {
    if (typeof productNode.name === 'string') result.title = productNode.name;
    if (typeof productNode.description === 'string') result.description = productNode.description;

    const b = productNode.brand;
    if (typeof b === 'string') result.brand = b;
    else if (b && typeof b === 'object') {
      const name = (b as { name?: unknown }).name;
      if (typeof name === 'string') result.brand = name;
    }

    const imgs = Array.isArray(productNode.image)
      ? productNode.image
      : productNode.image
        ? [productNode.image]
        : [];
    result.images.push(
      ...imgs
        .map((x) => {
          if (typeof x === 'string') return x;
          // eBay often uses ImageObject nodes: { "@type": "ImageObject", "url": "..." }
          if (x && typeof x === 'object') {
            const obj = x as { url?: unknown; contentUrl?: unknown };
            return String(obj.url ?? obj.contentUrl ?? '');
          }
          return '';
        })
        .filter((x) => /^https?:\/\//i.test(x)),
    );

    const offersRaw = productNode.offers;
    const offerList: Record<string, unknown>[] = Array.isArray(offersRaw)
      ? (offersRaw.filter(Boolean) as Record<string, unknown>[])
      : offersRaw && typeof offersRaw === 'object'
        ? [offersRaw as Record<string, unknown>]
        : [];
    applyOffers(offerList, iid, result);
  }

  // Title fallbacks
  if (!result.title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) result.title = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!result.title) {
    const og = html.match(/property="og:title"\s+content="([^"]+)"/);
    if (og) result.title = og[1];
  }

  // Description fallback
  if (!result.description) {
    const desc = html.match(/name="description"\s+content="([^"]+)"/);
    if (desc) result.description = desc[1];
  }

  // Images fallback
  if (!result.images.length) {
    const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (ogImg) result.images.push(ogImg[1]);
  }
  // eBay CDN images from <img> tags
  if (!result.images.length) {
    const imgRe = /src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/g;
    while ((m = imgRe.exec(html)) !== null && result.images.length < 24) {
      result.images.push(m[1]);
    }
  }

  // List price from strikethrough span (DOM fallback when priceSpecification absent).
  if (!result.listPrice) {
    const strikeMatch = html.match(
      /ux-textspans--STRIKETHROUGH[^>]*>\s*(?:US\s*)?([\$£€][\d,]+(?:\.\d{1,2})?)/,
    );
    if (strikeMatch) result.listPrice = strikeMatch[1];
  }

  // Discount percentage from transparency block.
  if (!result.discountPercent) {
    const discountMatch = html.match(/\((\d+%\s*off)\)/i);
    if (discountMatch) result.discountPercent = discountMatch[1];
  }

  // DOM price from [itemprop="price"] content attribute
  const priceTag = html.match(/<[^>]+itemprop="price"[^>]*>/);
  if (priceTag) {
    const contentM = priceTag[0].match(/content="([^"]+)"/);
    if (contentM && /^\d[\d.,]*$/.test(contentM[1])) result.domPrice = contentM[1];
  }

  // Currency from [itemprop="priceCurrency"]
  if (!result.currency) {
    const currTag = html.match(/<[^>]+itemprop="priceCurrency"[^>]*>/);
    if (currTag) {
      const contentM = currTag[0].match(/content="([^"]+)"/);
      if (contentM) result.currency = contentM[1];
    }
  }

  if (!result.title) return null;
  return result;
}

// ─── adapter ─────────────────────────────────────────────────────────────────

@Injectable()
export class EbayAdapter implements ScraperAdapter {
  private readonly logger = new Logger(EbayAdapter.name);
  readonly source = ProductSource.EBAY;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
    private readonly config: ConfigService,
  ) {}

  /** Resolve hub-page URLs to direct item URLs before scraping. */
  private resolveUrl(url: string): { scrapeUrl: string; pageIid: string | null } {
    let scrapeUrl = url;
    let pageIid: string | null = null;
    try {
      const parsed = new URL(url);
      pageIid = parsed.searchParams.get('iid');
      if (pageIid && parsed.pathname.startsWith('/p/')) {
        scrapeUrl = `https://www.ebay.com/itm/${pageIid}`;
      }
    } catch { /* invalid URL */ }
    return { scrapeUrl, pageIid };
  }

  /** Primary path: fetch rendered HTML via scrape.do, parse server-side. */
  private async fetchViaScrapeDoApi(
    scrapeUrl: string,
    pageIid: string | null,
  ): Promise<RawEbayData | null> {
    const token = this.config.get<string>('SCRAPE_DO_TOKEN')?.trim();
    if (!token) return null;

    try {
      const params = new URLSearchParams({ token, url: scrapeUrl, super: 'true', wait: '3000' });
      const { data: html } = await axios.get<string>(
        `http://api.scrape.do/?${params.toString()}`,
        {
          timeout: 60_000,
          maxContentLength: 10_000_000,
          headers: { Accept: 'text/html' },
          validateStatus: (s) => s >= 200 && s < 400,
        },
      );
      if (typeof html !== 'string' || html.length < 1000) return null;

      const data = parseEbayHtml(html, pageIid);
      this.logger.log(
        `[ebay] scrape.do step=done url=${scrapeUrl} ` +
          `title="${data?.title ?? 'none'}" ldFallback=${data?.ldPriceFallback ?? 'none'} domPrice=${data?.domPrice ?? 'none'}`,
      );
      return data;
    } catch (e) {
      this.logger.warn(
        `[ebay] scrape.do fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Fallback path: use Playwright (works when scrape.do is not configured). */
  private async fetchViaPlaywright(
    scrapeUrl: string,
    pageIid: string | null,
  ): Promise<RawEbayData | null> {
    const context = await this.playwright.newScrapeContext(
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
      scrapeUrl,
    );
    try {
      const page = await context.newPage();
      await page.goto(scrapeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .waitForSelector(
          'h1, [data-testid="ux-image-carousel-container"], script[type="application/ld+json"]',
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));

      const data = await page.evaluate((iid: string | null): RawEbayData => {
        const result: RawEbayData = { images: [] };

        const text = (el: Element | null | undefined): string =>
          el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const metaContent = (sel: string): string | undefined => {
          const el = document.querySelector(sel) as HTMLMetaElement | null;
          return el?.content?.trim() || undefined;
        };

        const jsonLdNodes: Record<string, unknown>[] = [];
        for (const script of Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        )) {
          const raw = script.textContent?.trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of arr) {
              if (node && typeof node === 'object')
                jsonLdNodes.push(node as Record<string, unknown>);
            }
          } catch { /* ignore */ }
        }

        const _isProductType = (t: unknown): boolean =>
          t === 'Product' ||
          t === 'product' ||
          (Array.isArray(t) && t.some((x) => String(x).toLowerCase() === 'product'));
        const _findProduct = (node: unknown): Record<string, unknown> | null => {
          if (!node || typeof node !== 'object') return null;
          const obj = node as Record<string, unknown>;
          if (_isProductType(obj['@type'])) return obj;
          for (const value of Object.values(obj)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                const found = _findProduct(item);
                if (found) return found;
              }
            } else {
              const found = _findProduct(value);
              if (found) return found;
            }
          }
          return null;
        };

        const productNode = jsonLdNodes.map(_findProduct).find(Boolean) ?? null;
        if (productNode) {
          if (typeof productNode.name === 'string') result.title = productNode.name;
          if (typeof productNode.description === 'string') result.description = productNode.description;
          const b = productNode.brand;
          if (typeof b === 'string') result.brand = b;
          else if (b && typeof b === 'object') {
            const name = (b as { name?: unknown }).name;
            if (typeof name === 'string') result.brand = name;
          }
          const imgs = Array.isArray(productNode.image)
            ? productNode.image
            : productNode.image ? [productNode.image] : [];
          result.images.push(
            ...imgs
              .map((x) => {
                if (typeof x === 'string') return x;
                if (x && typeof x === 'object') {
                  const obj = x as { url?: unknown; contentUrl?: unknown };
                  return String(obj.url ?? obj.contentUrl ?? '');
                }
                return '';
              })
              .filter((x) => /^https?:\/\//i.test(x)),
          );

          const offersRaw = productNode.offers;
          const offerList: Record<string, unknown>[] = Array.isArray(offersRaw)
            ? (offersRaw.filter(Boolean) as Record<string, unknown>[])
            : offersRaw && typeof offersRaw === 'object'
              ? [offersRaw as Record<string, unknown>]
              : [];

          const _normaliseCondition = (raw: string): string => {
            const map: Record<string, string> = { NewCondition: 'New', UsedCondition: 'Used', RefurbishedCondition: 'Refurbished', DamagedCondition: 'Damaged', OpenBoxCondition: 'Open Box' };
            const key = raw.split('/').pop() ?? raw;
            return map[key] ?? key.replace(/Condition$/, '').replace(/([A-Z])/g, ' $1').trim();
          };

          let matchedOffer: Record<string, unknown> | null = null;
          if (iid) {
            matchedOffer =
              offerList.find((o) => {
                const offerUrl = String(o.url ?? '');
                try { return new URL(offerUrl).searchParams.get('iid') === iid; }
                catch { return offerUrl.includes(`iid=${iid}`); }
              }) ?? null;
          }
          const activeOffer = matchedOffer ?? (offerList.length > 0 ? offerList[0] : null);
          if (matchedOffer) {
            if (matchedOffer.price != null) result.ldPriceMatched = String(matchedOffer.price);
            if (matchedOffer.priceCurrency != null) result.currency = String(matchedOffer.priceCurrency);
            if (matchedOffer.itemCondition != null) result.conditionLabel = _normaliseCondition(String(matchedOffer.itemCondition));
          } else if (offerList.length > 0) {
            const first = offerList[0];
            if (first.price != null) result.ldPriceFallback = String(first.price);
            if (!result.currency && first.priceCurrency != null) result.currency = String(first.priceCurrency);
            if (!result.conditionLabel && first.itemCondition != null) result.conditionLabel = _normaliseCondition(String(first.itemCondition));
          }
          if (activeOffer) {
            const ps = activeOffer.priceSpecification as Record<string, unknown> | undefined;
            if (ps && typeof ps === 'object' && ps.price != null) {
              const psName = String(ps.name ?? '').toLowerCase();
              if (psName.includes('list') || psName.includes('was') || psName.includes('original')) {
                result.listPrice = String(ps.price);
              }
            }
            const shippingDetails = activeOffer.shippingDetails;
            const shipping = Array.isArray(shippingDetails)
              ? (shippingDetails as Record<string, unknown>[])[0]
              : (shippingDetails as Record<string, unknown> | undefined);
            const shippingRate = shipping?.shippingRate as Record<string, unknown> | undefined;
            if (shippingRate?.value != null) result.shippingCost = String(shippingRate.value);
          }
        }

        if (!result.title) {
          result.title =
            text(document.querySelector('h1')) ||
            metaContent('meta[property="og:title"]') ||
            metaContent('meta[name="twitter:title"]');
        }
        if (!result.description) {
          result.description =
            metaContent('meta[name="description"]') ||
            metaContent('meta[property="og:description"]') ||
            metaContent('meta[name="twitter:description"]');
        }
        if (!result.images.length) {
          result.images.push(
            ...Array.from(
              document.querySelectorAll(
                'img[src*="ebayimg.com"], img[data-zoom-src*="ebayimg.com"], img[data-src*="ebayimg.com"]',
              ),
            )
              .map((img) => {
                const el = img as HTMLImageElement;
                // Prefer data-zoom-src (high-res); fall back to data-src (lazy load) then src.
                return (
                  el.getAttribute('data-zoom-src') ||
                  el.getAttribute('data-src') ||
                  (el.src?.includes('ebayimg.com') ? el.src : '')
                );
              })
              .filter((u) => /^https?:\/\//i.test(u)),
          );
        }
        if (!result.images.length) {
          const og = metaContent('meta[property="og:image"]');
          if (og) result.images.push(og);
        }

        const priceItemprop = document.querySelector('[itemprop="price"]');
        const priceContent = (priceItemprop as HTMLElement | null)?.getAttribute('content')?.trim();
        if (priceContent && /^\d[\d.,]*$/.test(priceContent)) {
          result.domPrice = priceContent;
        } else {
          const candidates = Array.from(
            document.querySelectorAll('.x-price-primary, [data-testid*="price"]'),
          )
            .map((el) => text(el))
            .filter(Boolean);
          result.domPrice =
            candidates.find((p) => /\d/.test(p) && /[$£€₦]|[A-Z]{3}/.test(p)) ?? undefined;
        }

        if (!result.currency) {
          const cur =
            document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || undefined;
          if (cur) result.currency = cur;
        }

        // List price from strikethrough span.
        if (!result.listPrice) {
          const strikeEl = document.querySelector('.ux-textspans--STRIKETHROUGH');
          if (strikeEl) {
            const t = strikeEl.textContent?.trim() ?? '';
            const m = t.match(/([\d,]+(?:\.\d{1,2})?)/);
            if (m) result.listPrice = m[1].replace(/,/g, '');
          }
        }

        // Discount percentage from transparency block.
        if (!result.discountPercent) {
          const discountEl = document.querySelector('.x-price-transparency--discount');
          if (discountEl) {
            const m = discountEl.textContent?.match(/\((\d+%\s*off)\)/i);
            if (m) result.discountPercent = m[1];
          }
        }

        return result;
      }, pageIid);

      return data.title ? data : null;
    } catch (e) {
      this.logger.warn(
        `[ebay] playwright error: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    } finally {
      await context.close();
    }
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const { scrapeUrl, pageIid } = this.resolveUrl(url);

    // Try scrape.do first (bypasses eBay bot detection); fall back to Playwright.
    const data =
      (await this.fetchViaScrapeDoApi(scrapeUrl, pageIid)) ??
      (await this.fetchViaPlaywright(scrapeUrl, pageIid));

    if (!data?.title) {
      this.logger.warn(`[ebay] no product data — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    // Price priority:
    // 1. JSON-LD offer whose iid matches the URL param (hub page multi-seller match)
    // 2. JSON-LD offers[0] — reliable on /itm/ single-listing pages
    // 3. DOM microdata price — least reliable, can be an auction current bid
    const priceRaw = data.ldPriceMatched || data.ldPriceFallback || data.domPrice || '';
    const normalizedPrice = parsePriceToDecimalString(priceRaw);

    if (!normalizedPrice) {
      this.logger.warn(`[ebay] no price — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    const listPriceNormalized = data.listPrice
      ? parsePriceToDecimalString(data.listPrice)
      : undefined;

    const saleNum = parseFloat(normalizedPrice);
    const listNum = listPriceNormalized ? parseFloat(listPriceNormalized) : 0;
    const savingsAmount =
      listNum > saleNum ? (listNum - saleNum).toFixed(2) : undefined;

    const currency = (data.currency || 'USD').toUpperCase();

    const descParts: string[] = [];
    if (data.description) descParts.push(data.description);
    if (data.conditionLabel) descParts.push(`Condition: ${data.conditionLabel}`);
    if (data.shippingCost) descParts.push(`Shipping: ${currency} ${data.shippingCost}`);

    this.logger.log(
      `[ebay] url=${url} title="${data.title}" price=${normalizedPrice}` +
        `${listPriceNormalized ? ` listPrice=${listPriceNormalized}` : ''}` +
        `${data.discountPercent ? ` discount=${data.discountPercent}` : ''}`,
    );

    return {
      title: data.title,
      price: normalizedPrice,
      currency,
      compareAtPrice: listPriceNormalized ?? undefined,
      discount: data.discountPercent,
      savingsAmount,
      images: [...new Set(data.images)].slice(0, 24),
      description: descParts.join('\n\n') || undefined,
      brand: data.brand,
      variants: [],
    };
  }
}
