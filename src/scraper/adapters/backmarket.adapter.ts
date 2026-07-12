import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';
import { scrapeDoGet } from '../utils/scrape-do-client.util';

// ─── Back Market Nuxt payload types ─────────────────────────────────────────

type NuxtNode = string | number | boolean | null | NuxtObject | NuxtArray;
type NuxtObject = { [key: string]: NuxtNode };
type NuxtArray = NuxtNode[];

/**
 * Back Market encodes its Nuxt payload as a flat array where object values are
 * integer indices pointing to other slots in the array. This helper resolves
 * an index into its full value by following references recursively.
 */
function resolve(arr: NuxtNode[], idx: number, depth = 0): NuxtNode {
  if (depth > 64) return null;
  const node = arr[idx];
  if (node === null || node === undefined) return null;
  if (typeof node === 'string' || typeof node === 'boolean') return node;
  if (typeof node === 'number') return node; // leaf number (price amounts are strings)
  if (Array.isArray(node)) {
    return (node as number[]).map((i) =>
      typeof i === 'number' ? resolve(arr, i, depth + 1) : i,
    );
  }
  // object — resolve each value
  const result: NuxtObject = {};
  for (const [k, v] of Object.entries(node as NuxtObject)) {
    result[k] = typeof v === 'number' ? resolve(arr, v, depth + 1) : v;
  }
  return result;
}

type RawBackMarketData = {
  title?: string;
  subtitle?: string;
  description?: string;
  brand?: string;
  model?: string;
  currency?: string;
  price?: string;
  compareAtPrice?: string;
  discountRate?: string;
  images: string[];
  condition?: string;
  warranty?: string;
  /** Grade/condition picker items (Fair, Good, Excellent, Premium) with prices */
  gradePicker?: Array<{ label: string; price: string; available: boolean; goodDeal: boolean; bestDeal: boolean }>;
  /** Storage picker items */
  storagePicker?: Array<{ label: string; price: string; available: boolean }>;
  /** Color picker items */
  colorPicker?: Array<{ label: string; price: string; available: boolean }>;
  merchantName?: string;
  shippingFree?: boolean;
};

// ─── HTML parser (scrape.do path) ───────────────────────────────────────────

function parseBackMarketHtml(html: string): RawBackMarketData | null {
  const result: RawBackMarketData = { images: [] };

  // Locate the large Nuxt JSON array (the payload script, not the config script)
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let nuxtArray: NuxtNode[] | null = null;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim();
    if (body.startsWith('[') && body.length > 10_000) {
      try {
        nuxtArray = JSON.parse(body) as NuxtNode[];
        break;
      } catch { /* skip */ }
    }
  }

  if (nuxtArray) {
    extractFromNuxtArray(nuxtArray, result);
  }

  // Title fallbacks (SSR renders the title tag)
  if (!result.title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) result.title = t[1].replace(/\s*\|\s*Back Market\s*$/i, '').trim();
  }
  if (!result.title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) {
      result.title = h1[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  // Price fallback from data-qa="productpage-product-price"
  if (!result.price) {
    // Match the element and look for a price in the next ~300 chars of markup
    const priceDomRe = /data-qa="productpage-product-price"[^>]*>([\s\S]{0,300})/;
    const priceDomM = priceDomRe.exec(html);
    if (priceDomM) {
      const chunk = priceDomM[1].replace(/<[^>]+>/g, ' ');
      const pm = chunk.match(/\$([\d,]+\.?\d{2})/);
      if (pm) result.price = pm[1].replace(/,/g, '');
    }
  }

  // Generic price-in-body fallback (any $ amount on the page)
  if (!result.price) {
    const m = html.match(/\$([\d,]+\.?\d{2})/);
    if (m) result.price = m[1].replace(/,/g, '');
  }

  // Description fallback
  if (!result.description) {
    const metaDesc = html.match(/name="description"\s+content="([^"]+)"/);
    if (metaDesc) result.description = metaDesc[1];
  }

  // Images fallback from CDN pattern
  if (!result.images.length) {
    const imgRe =
      /src="(https:\/\/d2e6ccujb3mkqf\.cloudfront\.net\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi;
    let imgM: RegExpExecArray | null;
    while ((imgM = imgRe.exec(html)) !== null && result.images.length < 24) {
      result.images.push(imgM[1]);
    }
  }
  if (!result.images.length) {
    const bm = /src="(https:\/\/[^"]*backmarket\.com[^"]+\.(?:jpg|jpeg|png|webp))"/gi;
    let imgM: RegExpExecArray | null;
    while ((imgM = bm.exec(html)) !== null && result.images.length < 24) {
      result.images.push(imgM[1]);
    }
  }

  if (!result.title) return null;
  return result;
}

function extractFromNuxtArray(arr: NuxtNode[], result: RawBackMarketData): void {
  // The top-level shape is:
  //   arr[1] = { data: 2, ... }
  //   arr[3] = { "pp-product-<uuid>": <N>, "pp-pickers:<hash>": <M>, ... }
  // Find the index dict (arr[3] or similar) to locate pp-product and pp-pickers
  let productIdx: number | null = null;
  let pickersIdx: number | null = null;

  for (let i = 0; i < arr.length; i++) {
    const node = arr[i];
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const keys = Object.keys(node as NuxtObject);
      for (const k of keys) {
        if (k.startsWith('pp-product-')) {
          const v = (node as NuxtObject)[k];
          if (typeof v === 'number') productIdx = v;
        }
        if (k.startsWith('pp-pickers:')) {
          const v = (node as NuxtObject)[k];
          if (typeof v === 'number') pickersIdx = v;
        }
      }
    }
    if (productIdx !== null && pickersIdx !== null) break;
  }

  // ── Product node ──────────────────────────────────────────────────────────
  if (productIdx !== null) {
    const productNode = arr[productIdx];
    if (productNode && typeof productNode === 'object' && !Array.isArray(productNode)) {
      const pn = productNode as NuxtObject;

      // titles
      const titlesIdx = pn['titles'];
      if (typeof titlesIdx === 'number') {
        const titles = arr[titlesIdx];
        if (titles && typeof titles === 'object' && !Array.isArray(titles)) {
          const t = titles as NuxtObject;
          const rawIdx = t['raw'];
          if (typeof rawIdx === 'number') {
            const raw = arr[rawIdx];
            if (typeof raw === 'string') result.title = raw;
          }
          const subIdx = t['subtitle'];
          if (typeof subIdx === 'number') {
            const sub = arr[subIdx];
            if (typeof sub === 'string') result.subtitle = sub;
          }
        }
      }

      // brand
      const brandIdx = pn['brand'];
      if (typeof brandIdx === 'number') {
        const brand = arr[brandIdx];
        if (typeof brand === 'string') result.brand = brand;
      }

      // model
      const modelIdx = pn['model'];
      if (typeof modelIdx === 'number') {
        const model = arr[modelIdx];
        if (typeof model === 'string') result.model = model;
      }

      // priceWhenNew (retail / compare-at price)
      const pwnIdx = pn['priceWhenNew'];
      if (typeof pwnIdx === 'number') {
        const pwn = arr[pwnIdx];
        if (pwn && typeof pwn === 'object' && !Array.isArray(pwn)) {
          const amountIdx = (pwn as NuxtObject)['amount'];
          const currencyIdx = (pwn as NuxtObject)['currency'];
          if (typeof amountIdx === 'number') {
            const a = arr[amountIdx];
            if (typeof a === 'string') result.compareAtPrice = a;
          }
          if (!result.currency && typeof currencyIdx === 'number') {
            const c = arr[currencyIdx];
            if (typeof c === 'string') result.currency = c;
          }
        }
      }

      // images
      const imagesIdx = pn['images'];
      if (typeof imagesIdx === 'number') {
        const imgs = arr[imagesIdx];
        if (Array.isArray(imgs)) {
          for (const imgRef of imgs as number[]) {
            if (typeof imgRef !== 'number') continue;
            const imgObj = arr[imgRef];
            if (imgObj && typeof imgObj === 'object' && !Array.isArray(imgObj)) {
              const urlIdx = (imgObj as NuxtObject)['url'];
              if (typeof urlIdx === 'number') {
                const url = arr[urlIdx];
                if (typeof url === 'string' && url.startsWith('http')) {
                  result.images.push(url);
                }
              }
            }
          }
        }
      }

      // seo description
      const seoIdx = pn['seo'];
      if (typeof seoIdx === 'number') {
        const seo = arr[seoIdx];
        if (seo && typeof seo === 'object' && !Array.isArray(seo)) {
          const descIdx = (seo as NuxtObject)['description'];
          if (typeof descIdx === 'number') {
            const desc = arr[descIdx];
            if (typeof desc === 'string') {
              result.description = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }
          }
        }
      }
    }
  }

  // ── Pickers node (grades, storage, color) ────────────────────────────────
  if (pickersIdx !== null) {
    const pickerNode = arr[pickersIdx];
    if (pickerNode && typeof pickerNode === 'object' && !Array.isArray(pickerNode)) {
      const pn = pickerNode as NuxtObject;

      // selectedOffer
      const selectedIdx = pn['selectedOffer'];
      if (typeof selectedIdx === 'number') {
        extractSelectedOffer(arr, selectedIdx, result);
      }

      // pickerGroups: grades, storage, color
      const groupsIdx = pn['pickerGroups'];
      if (typeof groupsIdx === 'number') {
        const groups = arr[groupsIdx];
        if (Array.isArray(groups)) {
          for (const gRef of groups as number[]) {
            if (typeof gRef !== 'number') continue;
            extractPickerGroup(arr, gRef, result);
          }
        }
      }
    }
  }
}

function extractSelectedOffer(
  arr: NuxtNode[],
  idx: number,
  result: RawBackMarketData,
): void {
  const offer = arr[idx];
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return;
  const o = offer as NuxtObject;

  // price
  const priceIdx = o['price'];
  if (typeof priceIdx === 'number') {
    const priceObj = arr[priceIdx];
    if (priceObj && typeof priceObj === 'object' && !Array.isArray(priceObj)) {
      const amtIdx = (priceObj as NuxtObject)['amount'];
      const curIdx = (priceObj as NuxtObject)['currency'];
      if (typeof amtIdx === 'number') {
        const a = arr[amtIdx];
        if (typeof a === 'string') result.price = a;
      }
      if (!result.currency && typeof curIdx === 'number') {
        const c = arr[curIdx];
        if (typeof c === 'string') result.currency = c;
      }
    }
  }

  // discount
  const discountIdx = o['discount'];
  if (typeof discountIdx === 'number') {
    const disc = arr[discountIdx];
    if (disc && typeof disc === 'object' && !Array.isArray(disc)) {
      const rateIdx = (disc as NuxtObject)['rate'];
      if (typeof rateIdx === 'number') {
        const rate = arr[rateIdx];
        if (typeof rate === 'string') result.discountRate = rate;
      }
    }
  }

  // warranty
  const wIdx = o['defaultWarrantyDelay'];
  if (typeof wIdx === 'number') {
    const w = arr[wIdx];
    if (typeof w === 'string') result.warranty = w;
  }

  // grade / condition label
  const gradeIdx = o['grade'];
  if (typeof gradeIdx === 'number') {
    const grade = arr[gradeIdx];
    if (grade && typeof grade === 'object' && !Array.isArray(grade)) {
      const nameIdx = (grade as NuxtObject)['name'];
      if (typeof nameIdx === 'number') {
        const name = arr[nameIdx];
        if (typeof name === 'string') result.condition = name;
      }
    }
  }

  // free shipping flag
  const shippingIdx = o['shipping'];
  if (typeof shippingIdx === 'number') {
    const shipping = arr[shippingIdx];
    if (shipping && typeof shipping === 'object' && !Array.isArray(shipping)) {
      const freeIdx = (shipping as NuxtObject)['free'];
      result.shippingFree = typeof freeIdx === 'number' && arr[freeIdx] !== null;
    }
  }

  // merchant name
  const merchantIdx = o['merchant'];
  if (typeof merchantIdx === 'number') {
    const merchant = arr[merchantIdx];
    if (merchant && typeof merchant === 'object' && !Array.isArray(merchant)) {
      const companyIdx = (merchant as NuxtObject)['company'];
      if (typeof companyIdx === 'number') {
        const company = arr[companyIdx];
        if (typeof company === 'string') result.merchantName = company;
      }
    }
  }
}

function extractPickerGroup(
  arr: NuxtNode[],
  idx: number,
  result: RawBackMarketData,
): void {
  const group = arr[idx];
  if (!group || typeof group !== 'object' || Array.isArray(group)) return;
  const g = group as NuxtObject;

  const idIdx = g['id'];
  const groupId = typeof idIdx === 'number' ? (arr[idIdx] as string) : (idIdx as string);

  const itemsIdx = g['items'];
  if (typeof itemsIdx !== 'number') return;
  const items = arr[itemsIdx];
  if (!Array.isArray(items)) return;

  const parsed: Array<{ label: string; price: string; available: boolean; goodDeal?: boolean; bestDeal?: boolean }> = [];

  for (const itemRef of items as number[]) {
    if (typeof itemRef !== 'number') continue;
    const item = arr[itemRef];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const it = item as NuxtObject;

    const labelIdx = it['label'];
    const label = typeof labelIdx === 'number' ? (arr[labelIdx] as string) : String(labelIdx ?? '');

    const priceObjIdx = it['price'];
    let price = '';
    if (typeof priceObjIdx === 'number') {
      const priceObj = arr[priceObjIdx];
      if (priceObj && typeof priceObj === 'object' && !Array.isArray(priceObj)) {
        const amtIdx = (priceObj as NuxtObject)['amount'];
        if (typeof amtIdx === 'number') {
          const a = arr[amtIdx];
          if (typeof a === 'string') price = a;
        }
      }
    }

    const availIdx = it['available'];
    const available = typeof availIdx === 'number' ? (arr[availIdx] as boolean) : Boolean(availIdx);

    const goodDealIdx = it['goodDeal'];
    const goodDeal = typeof goodDealIdx === 'number' ? (arr[goodDealIdx] as boolean) : Boolean(goodDealIdx);

    const bestDealIdx = it['bestDeal'];
    const bestDeal = typeof bestDealIdx === 'number' ? (arr[bestDealIdx] as boolean) : Boolean(bestDealIdx);

    if (label) parsed.push({ label, price, available, goodDeal, bestDeal });
  }

  if (groupId === 'grades') result.gradePicker = parsed as RawBackMarketData['gradePicker'];
  else if (groupId === 'storage') result.storagePicker = parsed;
  else if (groupId === 'color') result.colorPicker = parsed;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

@Injectable()
export class BackMarketAdapter implements ScraperAdapter {
  private readonly logger = new Logger(BackMarketAdapter.name);
  readonly source = ProductSource.BACK_MARKET;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
    private readonly config: ConfigService,
  ) {}

  private async fetchViaScrapeDoApi(url: string): Promise<RawBackMarketData | null> {
    const token = this.config.get<string>('SCRAPE_DO_TOKEN')?.trim();
    if (!token) return null;

    try {
      const { data: html } = await scrapeDoGet<string>(
        token,
        url,
        { super: 'true', wait: '3000', render: 'true' },
        { responseType: 'text' },
      );
      if (typeof html !== 'string' || html.length < 1000) return null;
      const data = parseBackMarketHtml(html);
      this.logger.log(
        `[backmarket] scrape.do title="${data?.title ?? 'none'}" price=${data?.price ?? 'none'}`,
      );
      return data;
    } catch (e) {
      this.logger.warn(
        `[backmarket] scrape.do failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async fetchViaPlaywright(url: string): Promise<RawBackMarketData | null> {
    const context = await this.playwright.newScrapeContext(
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
      url,
    );
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .waitForSelector(
          '[data-qa="productpage-product-price"], h1, script',
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500));

      const html = await page.content();
      // Reject Cloudflare / bot-detection interstitials
      if (html.length < 50_000 || /just a moment|enable javascript|cf-browser-verification/i.test(html)) {
        this.logger.warn('[backmarket] playwright returned a bot-challenge page — discarding');
        return null;
      }
      const data = parseBackMarketHtml(html);

      // If HTML parsing found a title but no price, query the live DOM directly.
      if (data && !data.price) {
        const domPrice = await page.evaluate(() => {
          const selectors = [
            '[data-qa="productpage-product-price"]',
            '[data-qa*="price"]',
            '[data-testid*="price"]',
            '[class*="price"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const text = (el as HTMLElement).innerText?.trim();
            if (text) {
              const m = text.match(/[\d,]+\.?\d*/);
              if (m) return m[0].replace(/,/g, '');
            }
          }
          // Last-resort: scan body text for a price pattern near a $ sign
          const body = document.body?.innerText ?? '';
          const m = body.match(/\$\s*([\d,]+\.?\d{2})/);
          return m ? m[1].replace(/,/g, '') : null;
        }).catch(() => null);

        if (domPrice) {
          data.price = domPrice;
          data.currency = data.currency ?? 'USD';
        }
      }

      return data;
    } catch (e) {
      this.logger.warn(
        `[backmarket] playwright error: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    } finally {
      await context.close();
    }
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const data =
      (await this.fetchViaScrapeDoApi(url)) ??
      (await this.fetchViaPlaywright(url));

    if (!data?.title) {
      this.logger.warn(`[backmarket] no data — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    const normalizedPrice = data.price ? parsePriceToDecimalString(data.price) : null;
    if (!normalizedPrice) {
      this.logger.warn(`[backmarket] no price — falling back to generic url=${url}`);
      return this.generic.scrape(url);
    }

    const currency = (data.currency || 'USD').toUpperCase();

    // Use retail price (priceWhenNew) as compare-at only when it's genuinely
    // higher than the selected offer price.
    const compareAtNorm = data.compareAtPrice
      ? parsePriceToDecimalString(data.compareAtPrice)
      : undefined;
    const saleNum = parseFloat(normalizedPrice);
    const compareAtNum = compareAtNorm ? parseFloat(compareAtNorm) : 0;
    const compareAtPrice = compareAtNum > saleNum ? (compareAtNorm ?? undefined) : undefined;

    // Savings
    const savingsAmount =
      compareAtNum > saleNum
        ? (compareAtNum - saleNum).toFixed(2)
        : undefined;

    // Condition label mapping (VERY_GOOD → "Very Good")
    const conditionMap: Record<string, string> = {
      VERY_GOOD: 'Very Good',
      GOOD: 'Good',
      FAIR: 'Fair',
      EXCELLENT: 'Excellent',
      PREMIUM: 'Premium',
    };
    const conditionLabel = data.condition
      ? (conditionMap[data.condition] ?? data.condition)
      : undefined;

    // Description: combine SEO text + condition + warranty + merchant info
    const descParts: string[] = [];
    if (data.description) descParts.push(data.description);
    if (conditionLabel) descParts.push(`Condition: ${conditionLabel}`);
    if (data.warranty) descParts.push(`Warranty: ${data.warranty}`);
    if (data.shippingFree) descParts.push('Shipping: Free');
    if (data.merchantName) descParts.push(`Sold by: ${data.merchantName}`);

    // Variants: condition grades (with prices) + storage + color
    const variants: ScrapedProduct['variants'] = [];

    if (data.gradePicker?.length) {
      variants.push({
        name: 'Condition',
        options: data.gradePicker
          .filter((g) => g.available)
          .map((g) => (g.price ? `${g.label} ($${g.price})` : g.label)),
      });
    }
    if (data.storagePicker?.length) {
      variants.push({
        name: 'Storage',
        options: data.storagePicker
          .filter((s) => s.available)
          .map((s) => (s.price ? `${s.label} ($${s.price})` : s.label)),
      });
    }
    if (data.colorPicker?.length) {
      variants.push({
        name: 'Color',
        options: data.colorPicker
          .filter((c) => c.available)
          .map((c) => c.label),
      });
    }

    this.logger.log(
      `[backmarket] url=${url} title="${data.title}" price=${normalizedPrice}` +
        `${compareAtPrice ? ` compareAt=${compareAtPrice}` : ''}` +
        `${data.discountRate ? ` discount=${data.discountRate}` : ''}` +
        `${conditionLabel ? ` condition=${conditionLabel}` : ''}`,
    );

    return {
      title: data.title,
      price: normalizedPrice,
      currency,
      compareAtPrice,
      discount: data.discountRate,
      savingsAmount,
      images: [...new Set(data.images)].slice(0, 24),
      description: descParts.join('\n\n') || undefined,
      brand: data.brand,
      variants,
    };
  }
}
