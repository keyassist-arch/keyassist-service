import { Injectable } from '@nestjs/common';
import { ProductSource } from '../../common/enums/product-source.enum';
import { GenericAdapter } from './generic.adapter';
import { PlaywrightService } from '../playwright.service';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { ScraperAdapter } from '../interfaces/scraper-adapter.interface';
import {
  parseFirstUsdInString,
  parsePriceToDecimalString,
} from '../utils/normalize-price.util';
import { currencyFromPriceString } from '../utils/currency-symbol.util';

type SheinPagePayload = {
  title: string;
  priceText: string;
  currency: string;
  images: string[];
  description: string;
};

function inferSheinCurrencyFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('shein.co.uk') || u.includes('uk.shein')) {
    return 'GBP';
  }
  if (
    u.includes('eur.shein') ||
    /\/(de|fr|es|it|nl|pl|be|at|pt|ie)\.shein\./.test(u)
  ) {
    return 'EUR';
  }
  if (u.includes('mx.shein') || u.includes('br.shein')) {
    return u.includes('br.') ? 'BRL' : 'MXN';
  }
  if (u.includes('shein.in') || u.includes('in.shein')) {
    return 'INR';
  }
  return 'USD';
}

@Injectable()
export class SheinAdapter implements ScraperAdapter {
  readonly source = ProductSource.SHEIN;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly generic: GenericAdapter,
  ) {}

  async scrape(url: string): Promise<ScrapedProduct> {
    const { page, context } = await this.playwright.loadPage(url, {
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 60_000 },
    });
    try {
      await page
        .waitForSelector(
          'h1, script[type="application/ld+json"], [class*="product-intro"]',
          { timeout: 25_000 },
        )
        .catch(() => undefined);

      const data = (await page.evaluate(() => {
        const images: string[] = [];
        let title = '';
        let priceText = '';
        let currency = '';
        let description = '';

        const pushImg = (u: string | undefined) => {
          if (u && !u.startsWith('data:') && !images.includes(u)) {
            images.push(u);
          }
        };

        const ldScripts = document.querySelectorAll(
          'script[type="application/ld+json"]',
        );
        for (const s of ldScripts) {
          try {
            const raw = s.textContent?.trim();
            if (!raw) {
              continue;
            }
            const j = JSON.parse(raw) as unknown;
            const nodes = Array.isArray(j) ? j : [j];
            for (const node of nodes) {
              if (!node || typeof node !== 'object') {
                continue;
              }
              const o = node as Record<string, unknown>;
              const types = o['@type'];
              const isProduct =
                types === 'Product' ||
                types === 'product' ||
                (Array.isArray(types) &&
                  types.some((t) => t === 'Product' || t === 'product'));
              if (!isProduct) {
                continue;
              }
              if (typeof o.name === 'string') {
                title = title || o.name;
              }
              if (typeof o.description === 'string') {
                description = description || o.description;
              }
              const img = o.image;
              if (typeof img === 'string') {
                pushImg(img);
              } else if (Array.isArray(img)) {
                for (const x of img) {
                  if (typeof x === 'string') {
                    pushImg(x);
                  }
                }
              }
              const offers = o.offers;
              const offerList = Array.isArray(offers)
                ? offers
                : offers
                  ? [offers]
                  : [];
              for (const off of offerList) {
                if (!off || typeof off !== 'object') {
                  continue;
                }
                const of = off as Record<string, unknown>;
                if (of['@type'] === 'AggregateOffer') {
                  const ag = of;
                  if (typeof ag.lowPrice === 'number') {
                    priceText = String(ag.lowPrice);
                  } else if (typeof ag.highPrice === 'number' && !priceText) {
                    priceText = String(ag.highPrice);
                  }
                  if (typeof ag.priceCurrency === 'string') {
                    currency = ag.priceCurrency;
                  }
                } else if (of.price != null && !priceText) {
                  priceText = String(of.price);
                  if (typeof of.priceCurrency === 'string') {
                    currency = of.priceCurrency;
                  }
                }
              }
            }
          } catch {
            /* skip */
          }
        }

        const next = document.querySelector('#__NEXT_DATA__');
        if (next?.textContent && (!title || !priceText)) {
          try {
            const nd = JSON.parse(next.textContent) as Record<string, unknown>;
            const pp = nd.props as Record<string, unknown> | undefined;
            const pageProps = pp?.pageProps as
              | Record<string, unknown>
              | undefined;
            const detail =
              pageProps?.productDetail ||
              pageProps?.goodsDetail ||
              pageProps?.detail;
            if (detail && typeof detail === 'object') {
              const d = detail as Record<string, unknown>;
              const n =
                (d.goods_name as string) ||
                (d.goodsName as string) ||
                (d.title as string);
              if (n) {
                title = n;
              }
              const sale =
                (d.salePrice as { amount?: unknown } | undefined)?.amount ??
                (d.sale_price as { amount?: unknown } | undefined)?.amount ??
                (d.retailPrice as { amount?: unknown } | undefined)?.amount;
              if (sale != null) {
                priceText = String(sale);
              }
              const sp = d.salePrice;
              if (sp && typeof sp === 'object' && 'currency' in sp) {
                const c = (sp as { currency?: unknown }).currency;
                if (typeof c === 'string') {
                  currency = c;
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        if (!title) {
          title =
            document
              .querySelector('[class*="product-intro__head-name"]')
              ?.textContent?.trim() ||
            document
              .querySelector('[class*="ProductIntroHeadName"]')
              ?.textContent?.trim() ||
            document
              .querySelector('h1.product-intro__title')
              ?.textContent?.trim() ||
            document.querySelector('main h1')?.textContent?.trim() ||
            document.querySelector('h1')?.textContent?.trim() ||
            '';
        }

        if (!priceText) {
          const priceCandidates = [
            '[class*="productPrice"] [class*="sale"]',
            '[class*="product-intro__main-price"]',
            '[class*="ProductIntroMainPrice"]',
            '[class*="price--sale"]',
            '[class*="goods-price"]',
            '[itemprop="price"]',
          ];
          for (const sel of priceCandidates) {
            const el = document.querySelector(sel);
            const t = el?.textContent?.replace(/\s+/g, ' ').trim();
            if (t && /\d/.test(t)) {
              priceText = t;
              break;
            }
          }
        }

        if (!currency) {
          const curMeta =
            document
              .querySelector('meta[property="product:price:currency"]')
              ?.getAttribute('content') ||
            document
              .querySelector('meta[itemprop="priceCurrency"]')
              ?.getAttribute('content');
          if (curMeta) {
            currency = curMeta;
          }
        }

        const ogTitle = document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute('content');
        if (ogTitle && !title) {
          title = ogTitle.trim();
        }
        const ogImg = document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute('content');
        if (ogImg) {
          pushImg(ogImg);
        }
        const ogDesc = document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute('content');
        if (ogDesc && !description) {
          description = ogDesc.trim();
        }

        const metaPrice =
          document
            .querySelector('meta[property="product:price:amount"]')
            ?.getAttribute('content') ||
          document
            .querySelector('meta[itemprop="price"]')
            ?.getAttribute('content');
        if (metaPrice && !priceText) {
          priceText = metaPrice;
        }

        for (const img of document.querySelectorAll(
          '[class*="product-intro"] img[src*="shein"], .crop-image-container img, .juxtapose img',
        )) {
          pushImg((img as HTMLImageElement).src);
        }

        return {
          title: title.replace(/\s+/g, ' ').trim(),
          priceText,
          currency: (currency || '').toUpperCase().slice(0, 8),
          images,
          description: description
            ? description.replace(/\s+/g, ' ').trim()
            : '',
        };
      })) as SheinPagePayload;

      const currency =
        currencyFromPriceString(data.priceText) ||
        inferSheinCurrencyFromUrl(url) ||
        data.currency ||
        'USD';
      let priceStr =
        parseFirstUsdInString(data.priceText) ??
        parsePriceToDecimalString(data.priceText);

      if (!priceStr && data.priceText) {
        const eu = data.priceText.match(
          /(\d{1,3}(?:\.\d{3})*,\d{2})\s*€|€\s*(\d{1,3}(?:\.\d{3})*,\d{2})/,
        );
        if (eu) {
          const n = (eu[1] || eu[2]).replace(/\./g, '').replace(',', '.');
          priceStr = parseFloat(n).toFixed(2);
        }
        const gbp = data.priceText.match(
          /£\s*(\d+(?:\.\d{2})?)|(\d+(?:\.\d{2})?)\s*£/,
        );
        if (gbp && !priceStr) {
          priceStr = parseFloat(gbp[1] || gbp[2]).toFixed(2);
        }
      }

      if (data.title && priceStr) {
        return {
          title: data.title,
          price: priceStr,
          currency,
          images: [...new Set(data.images)].filter(Boolean).slice(0, 24),
          description: data.description || undefined,
          brand: 'SHEIN',
          variants: [],
        };
      }
    } catch {
      /* fall through */
    } finally {
      await context.close();
    }
    return this.generic.scrape(url);
  }
}
