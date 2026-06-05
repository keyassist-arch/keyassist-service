/**
 * Smoke-test the BackMarket adapter end-to-end against a live URL.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-backmarket-scrape.ts
 *
 * Reads SCRAPE_DO_TOKEN from .env (or the process environment).
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const URL_TO_TEST = 'https://www.backmarket.com/en-us/p/iphone-15-plus';

// ── Inline the same helpers from backmarket.adapter.ts ───────────────────────

type NuxtNode = string | number | boolean | null | NuxtObject | NuxtArray;
type NuxtObject = { [key: string]: NuxtNode };
type NuxtArray = NuxtNode[];

type RawBackMarketData = {
  title?: string;
  subtitle?: string;
  description?: string;
  brand?: string;
  currency?: string;
  price?: string;
  compareAtPrice?: string;
  images: string[];
  condition?: string;
};

function resolve(arr: NuxtNode[], idx: number, depth = 0): NuxtNode {
  if (depth > 64) return null;
  const node = arr[idx];
  if (node === null || node === undefined) return null;
  if (typeof node === 'string' || typeof node === 'boolean') return node;
  if (typeof node === 'number') return node;
  if (Array.isArray(node)) {
    return (node as number[]).map((i) =>
      typeof i === 'number' ? resolve(arr, i, depth + 1) : i,
    );
  }
  const result: NuxtObject = {};
  for (const [k, v] of Object.entries(node as NuxtObject)) {
    result[k] = typeof v === 'number' ? resolve(arr, v, depth + 1) : v;
  }
  return result;
}

function extractFromNuxtArray(arr: NuxtNode[], result: RawBackMarketData): void {
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

  console.log(`  Nuxt: productIdx=${productIdx} pickersIdx=${pickersIdx}`);

  if (productIdx !== null) {
    const pn = arr[productIdx] as NuxtObject | null;
    if (pn && typeof pn === 'object' && !Array.isArray(pn)) {
      const titlesIdx = pn['titles'];
      if (typeof titlesIdx === 'number') {
        const titles = arr[titlesIdx] as NuxtObject;
        if (titles && typeof titles === 'object') {
          const rawIdx = titles['raw'];
          if (typeof rawIdx === 'number') {
            const raw = arr[rawIdx];
            if (typeof raw === 'string') result.title = raw;
          }
        }
      }
      const brandIdx = pn['brand'];
      if (typeof brandIdx === 'number') {
        const brand = arr[brandIdx];
        if (typeof brand === 'string') result.brand = brand;
      }
    }
  }

  if (pickersIdx !== null) {
    const pn = arr[pickersIdx] as NuxtObject | null;
    if (pn && typeof pn === 'object' && !Array.isArray(pn)) {
      const selectedIdx = pn['selectedOffer'];
      if (typeof selectedIdx === 'number') {
        const offer = arr[selectedIdx] as NuxtObject | null;
        if (offer && typeof offer === 'object' && !Array.isArray(offer)) {
          const priceIdx = offer['price'];
          if (typeof priceIdx === 'number') {
            const priceObj = arr[priceIdx] as NuxtObject;
            if (priceObj && typeof priceObj === 'object') {
              const amtIdx = (priceObj)['amount'];
              if (typeof amtIdx === 'number') {
                const a = arr[amtIdx];
                if (typeof a === 'string') result.price = a;
              }
              const curIdx = (priceObj)['currency'];
              if (typeof curIdx === 'number') {
                const c = arr[curIdx];
                if (typeof c === 'string') result.currency = c;
              }
            }
          }
        }
      } else {
        console.log('  Nuxt: selectedOffer key =', selectedIdx, '(not a number — no selected offer on this page)');
      }
    }
  }
}

function parseBackMarketHtml(html: string): RawBackMarketData | null {
  const result: RawBackMarketData = { images: [] };

  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let nuxtArray: NuxtNode[] | null = null;
  let m: RegExpExecArray | null;
  let nuxtScriptCount = 0;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim();
    if (body.startsWith('[') && body.length > 10_000) {
      nuxtScriptCount++;
      try {
        nuxtArray = JSON.parse(body) as NuxtNode[];
        console.log(`  Found Nuxt array, length=${nuxtArray.length}`);
        break;
      } catch { /* skip */ }
    }
  }
  if (!nuxtArray) console.log(`  No Nuxt array found (scanned ${nuxtScriptCount} candidates)`);

  if (nuxtArray) {
    extractFromNuxtArray(nuxtArray, result);
  }

  if (!result.title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) result.title = t[1].replace(/\s*\|\s*Back Market\s*$/i, '').trim();
  }
  if (!result.title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) result.title = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!result.price) {
    const priceDomRe = /data-qa="productpage-product-price"[^>]*>([\s\S]{0,300})/;
    const priceDomM = priceDomRe.exec(html);
    if (priceDomM) {
      const chunk = priceDomM[1].replace(/<[^>]+>/g, ' ');
      const pm = chunk.match(/\$([\d,]+\.?\d{2})/);
      if (pm) { result.price = pm[1].replace(/,/g, ''); console.log('  Price from data-qa DOM fallback'); }
    }
  }

  if (!result.price) {
    const mp = html.match(/\$([\d,]+\.?\d{2})/);
    if (mp) { result.price = mp[1].replace(/,/g, ''); console.log('  Price from generic $ body fallback'); }
  }

  if (!result.description) {
    const metaDesc = html.match(/name="description"\s+content="([^"]+)"/);
    if (metaDesc) result.description = metaDesc[1];
  }

  if (!result.title) return null;
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.SCRAPE_DO_TOKEN?.trim();

  // ── Path 1: scrape.do ─────────────────────────────────────────────────────
  console.log('\n══ Path 1: scrape.do ════════════════════════════════════════');
  if (!token) {
    console.log('  SCRAPE_DO_TOKEN not set — skipping');
  } else {
    try {
      const params = new URLSearchParams({
        token,
        url: URL_TO_TEST,
        super: 'true',
        wait: '3000',
        render: 'true',
      });
      console.log('  Fetching via scrape.do...');
      const { data: html } = await axios.get<string>(
        `http://api.scrape.do/?${params.toString()}`,
        { timeout: 60_000, maxContentLength: 10_000_000, headers: { Accept: 'text/html' } },
      );
      console.log(`  HTML length: ${html.length}`);
      const data = parseBackMarketHtml(html);
      if (data) {
        console.log('\n  ── Extracted ─────────────────────────────────────────');
        console.log('  title      :', data.title);
        console.log('  price      :', data.price, data.currency ?? '');
        console.log('  brand      :', data.brand);
        console.log('  description:', data.description?.slice(0, 120));
        console.log('  images     :', data.images.length, 'URLs');
      } else {
        console.log('  parseBackMarketHtml returned null (no title found)');
      }
    } catch (e) {
      console.error('  scrape.do error:', e instanceof Error ? e.message : e);
    }
  }

  // ── Path 2: Playwright direct ─────────────────────────────────────────────
  console.log('\n══ Path 2: Playwright direct ════════════════════════════════');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    console.log('  Navigating...');
    await page.goto(URL_TO_TEST, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-qa="productpage-product-price"], h1, script', { timeout: 20_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    console.log(`  HTML length: ${html.length}`);
    const data = parseBackMarketHtml(html);

    // DOM price fallback
    let domPrice: string | null = null;
    if (data && !data.price) {
      domPrice = await page.evaluate(() => {
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
        const body = document.body?.innerText ?? '';
        const m = body.match(/\$\s*([\d,]+\.?\d{2})/);
        return m ? m[1].replace(/,/g, '') : null;
      }).catch(() => null);

      if (domPrice && data) {
        data.price = domPrice;
        data.currency = 'USD';
        console.log('  Price from live DOM evaluate fallback');
      }
    }

    if (data) {
      console.log('\n  ── Extracted ─────────────────────────────────────────');
      console.log('  title      :', data.title);
      console.log('  price      :', data.price, data.currency ?? '');
      console.log('  brand      :', data.brand);
      console.log('  description:', data.description?.slice(0, 120));
      console.log('  images     :', data.images.length, 'URLs');
    } else {
      console.log('  parseBackMarketHtml returned null');
    }
  } catch (e) {
    console.error('  playwright error:', e instanceof Error ? e.message : e);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('\n══ Done ══════════════════════════════════════════════════════\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
