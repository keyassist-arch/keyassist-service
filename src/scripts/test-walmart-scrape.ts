/**
 * Smoke-test the Walmart adapter end-to-end against a live URL.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-walmart-scrape.ts [url]
 *
 * Defaults to a mattress product if no URL is given.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { parsePriceToDecimalString } from '../scraper/utils/normalize-price.util';
import type { ProductConfigurationPrice } from '../products/entities/product.entity';

chromium.use(StealthPlugin());

const URL_TO_TEST =
  process.argv[2] ??
  'https://www.walmart.com/ip/Queen-Size-Mattress-IEI-12-inch-Memory-Foam-Mattress-in-a-Box-with-Spring-CertiPUR-US-Certified/11363020203';

// ── Inline the same parse logic from walmart.adapter.ts ──────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAvailability(status: string | undefined): string {
  if (!status) return 'unknown';
  if (status === 'IN_STOCK') return 'in_stock';
  if (status === 'OUT_OF_STOCK') return 'out_of_stock';
  return 'unknown';
}

interface VariantCriterion {
  id: string;
  name: string;
  variantList: { id: string; name: string; availabilityStatus: string; selected: boolean; products: string[] }[];
}

function buildVariantSelections(
  variantIds: string[],
  criteria: VariantCriterion[],
): Record<string, string> | undefined {
  const sel: Record<string, string> = {};
  for (const vid of variantIds) {
    for (const axis of criteria) {
      const option = axis.variantList.find((v) => v.id === vid);
      if (option) { sel[axis.name] = option.name; break; }
    }
  }
  return Object.keys(sel).length ? sel : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseNextData(json: string): any {
  const root = JSON.parse(json);
  const initData = root?.props?.pageProps?.initialData?.data;
  const product = initData?.product;
  const idml = initData?.idml;
  const reviews = initData?.reviews;
  if (!product) return null;

  const pi = product.priceInfo;
  const rawPrice = pi?.currentPrice?.price ?? 0;
  const currency = pi?.currentPrice?.currencyUnit ?? 'USD';
  const price = parsePriceToDecimalString(rawPrice) ?? rawPrice.toFixed(2);

  const wasRaw = pi?.wasPrice?.price ?? pi?.listPrice?.price ?? null;
  const compareAtPrice = wasRaw != null ? (parsePriceToDecimalString(wasRaw) ?? String(wasRaw)) : null;

  const images: string[] = (product.imageInfo?.allImages ?? [])
    .map((img: { url?: string }) => img.url).filter(Boolean);

  const descHtml = idml?.shortDescription ?? product.shortDescription ?? null;
  let description = descHtml ? stripHtml(descHtml).slice(0, 1000) : undefined;
  if (reviews?.averageOverallRating) {
    description = (description ?? '') + `\n\nRating: ${reviews.averageOverallRating}/5 (${reviews.totalReviewCount} reviews)`;
  }

  const criteria: VariantCriterion[] = product.variantCriteria ?? [];
  const variants = criteria.map((axis: VariantCriterion) => ({
    name: axis.name,
    options: axis.variantList.map((v) => v.name),
  }));

  const variantsMap: Record<string, {
    availabilityStatus?: string;
    priceInfo?: { currentPrice?: { price?: number; currencyUnit?: string } };
    variants?: string[];
    usItemId?: string;
  }> = product.variantsMap ?? {};

  const configurationPrices: ProductConfigurationPrice[] = [];
  for (const [productId, entry] of Object.entries(variantsMap)) {
    const ep = entry.priceInfo?.currentPrice?.price;
    if (ep == null || ep <= 0) continue;
    const entryPriceStr = parsePriceToDecimalString(ep) ?? ep.toFixed(2);
    const variantIds = entry.variants ?? [];
    const variantSelections = buildVariantSelections(variantIds, criteria);
    const labelParts = variantSelections ? Object.values(variantSelections) : variantIds;
    configurationPrices.push({
      label: labelParts.join(' · ') || productId,
      originalPrice: entryPriceStr,
      sku: entry.usItemId ?? productId,
      variantSelections,
      available: !entry.availabilityStatus || entry.availabilityStatus === 'IN_STOCK',
      metadata: { source: 'walmart', walmartProductId: productId },
    });
  }

  return {
    title: product.name?.trim(),
    price,
    currency,
    brand: product.brand,
    availability: normalizeAvailability(product.availabilityStatus),
    compareAtPrice,
    images,
    description,
    variants,
    configurationPrices,
    asin: product.usItemId,
  };
}

// ── Print result ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printResult(result: any) {
  console.log('\n── Extracted product ────────────────────────────────────────');
  console.log('  title      :', result.title);
  console.log('  brand      :', result.brand);
  console.log('  price      :', result.price, result.currency);
  console.log('  compareAt  :', result.compareAtPrice ?? '—');
  console.log('  availability:', result.availability);
  console.log('  asin (itemId):', result.asin);
  console.log('  images     :', result.images.length, 'urls');
  if (result.images[0]) console.log('  first img  :', result.images[0].slice(0, 80));
  console.log('  description:', result.description?.slice(0, 120) ?? '—');

  console.log('\n── Variants ─────────────────────────────────────────────────');
  for (const v of result.variants) {
    console.log(`  ${v.name}: [${v.options.join(', ')}]`);
  }

  console.log('\n── configurationPrices ──────────────────────────────────────');
  for (const row of result.configurationPrices) {
    const avail = row.available ? 'in_stock' : 'out_of_stock';
    console.log(`  ${String(row.label).padEnd(30)} $${String(row.originalPrice).padStart(8)}  ${avail}`);
  }

  console.log('\n── Full JSON ────────────────────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { readFileSync } = await import('fs');
  const { resolve } = await import('path');

  console.log('\n══ Walmart Adapter Test ═════════════════════════════════════');

  // ── Path 1: parse local walmart.html (fast, no network) ──────────────────
  const localHtmlPath = resolve(process.cwd(), 'walmart.html');
  try {
    const html = readFileSync(localHtmlPath, 'utf8');
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>(.*?)<\/script>/s);
    if (m) {
      console.log('\n══ Path 1: local walmart.html ════════════════════════════');
      console.log(`  HTML size: ${html.length.toLocaleString()} bytes`);
      const result = parseNextData(m[1]);
      if (result) {
        printResult(result);
      } else {
        console.error('  parseNextData returned null from local file');
      }
    }
  } catch {
    console.log('  walmart.html not found — skipping local parse');
  }

  // ── Path 2: live scrape via scrape.do → Playwright setContent ───────────
  console.log('\n══ Path 2: Live scrape ══════════════════════════════════════');
  console.log(`  url: ${URL_TO_TEST}`);

  const scrapeDoToken = process.env.SCRAPE_DO_TOKEN?.trim();
  let liveHtml: string | null = null;

  if (scrapeDoToken) {
    console.log('  SCRAPE_DO_TOKEN found — fetching via scrape.do…');
    try {
      const params = new URLSearchParams({
        token: scrapeDoToken,
        url: URL_TO_TEST,
        super: 'true',
        wait: '4000',
        render: 'true',
      });
      const { data } = await axios.get<string>(
        `http://api.scrape.do/?${params.toString()}`,
        { timeout: 60_000, maxContentLength: 10_000_000, headers: { Accept: 'text/html' } },
      );
      if (typeof data === 'string' && data.length > 500) {
        liveHtml = data;
        console.log(`  Fetched ${data.length.toLocaleString()} bytes`);
      } else {
        console.log('  scrape.do returned empty/short response');
      }
    } catch (e) {
      console.error('  scrape.do error:', e instanceof Error ? e.message : e);
    }
  } else {
    console.log('  SCRAPE_DO_TOKEN not set — skipping live scrape');
  }

  if (liveHtml) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    try {
      await page.setContent(liveHtml, { waitUntil: 'domcontentloaded' });
      const nextDataJson = await page.evaluate(
        () => document.getElementById('__NEXT_DATA__')?.textContent ?? null,
      );
      console.log(`  __NEXT_DATA__ present=${nextDataJson != null} len=${nextDataJson?.length ?? 0}`);
      if (nextDataJson) {
        const result = parseNextData(nextDataJson);
        if (result) {
          printResult(result);
        } else {
          console.error('  parseNextData returned null from live page');
        }
      } else {
        console.log('  __NEXT_DATA__ not found in live HTML');
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }

  console.log('\n══ Done ═════════════════════════════════════════════════════\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
