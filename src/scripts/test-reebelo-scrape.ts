/**
 * Smoke-test the Reebelo adapter end-to-end.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-reebelo-scrape.ts [url]
 *
 * Path 1: parses local reebelo.html (fast, no network).
 * Path 2: live fetch via scrape.do (uses SCRAPE_DO_TOKEN from .env).
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
  'https://reebelo.com/collections/launcher-xl-iron-individual';

// ── Inline parse logic (mirrors reebelo.adapter.ts) ──────────────────────────

function centsToPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

function resolveDisplayValue(v: { value?: string; displayValue?: string | null }): string {
  return (v.displayValue?.trim() || v.value?.trim()) ?? '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseNextData(json: string): any {
  const root = JSON.parse(json);
  const pp = root?.props?.pageProps;
  if (!pp) return null;

  const product = pp.product;
  const selectedSku = pp.selectedSku;
  const availableVariants: any[] = pp.availableVariants ?? [];
  if (!product?.name) return null;

  const title = (product.title ?? product.name).trim();

  const selectedOfferPrice = selectedSku?.offers?.[0]?.price;
  const cheapest = availableVariants.reduce<number | null>((min, av) => {
    if (av.price == null) return min;
    return min == null || av.price < min ? av.price : min;
  }, null);
  const rawPriceCents = selectedOfferPrice ?? cheapest ?? 0;
  const price = parsePriceToDecimalString(centsToPrice(rawPriceCents)) ?? centsToPrice(rawPriceCents);

  const imageSource = selectedSku?.images?.length ? selectedSku.images : product.images ?? [];
  const images: string[] = imageSource.map((i: any) => i.url).filter(Boolean);
  if (product.image?.url && !images.includes(product.image.url)) images.unshift(product.image.url);

  let description: string = product.description?.trim() ?? '';
  const conditions: any[] = pp.additionalInfo?.conditions ?? [];
  if (conditions.length) {
    description += (description ? '\n\nCondition Guide:\n' : 'Condition Guide:\n') +
      conditions.map((c: any) => `${c.name}: ${c.description}`).join('\n');
  }
  const warranty = pp.additionalInfo?.categoryWarrantyInfo;
  if (warranty?.eligible && warranty.warrantyLength) {
    description += `\n\nWarranty: ${warranty.warrantyLength} ${warranty.warrantyUnit ?? 'month'}(s)`;
  }

  const selectedStock = selectedSku?.offers?.[0]?.stock ?? 0;
  const availability = selectedStock > 0 ? 'in_stock' : 'out_of_stock';

  const variants = (product.variants ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((entry: any) => ({
      name: entry.variant.name,
      options: entry.values
        .slice()
        .sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((v: any) => resolveDisplayValue(v))
        .filter(Boolean),
    }))
    .filter((v: any) => v.options.length > 0);

  const configurationPrices: ProductConfigurationPrice[] = [];
  for (const av of availableVariants) {
    if (av.price == null) continue;
    const avPriceStr = parsePriceToDecimalString(centsToPrice(av.price)) ?? centsToPrice(av.price);
    const variantSelections: Record<string, string> = {};
    for (const sv of av.variants ?? []) {
      if (sv.variant?.name) variantSelections[sv.variant.name] = resolveDisplayValue(sv.value);
    }
    const labelParts = Object.values(variantSelections).filter(Boolean);
    configurationPrices.push({
      label: labelParts.join(' · ') || (av.skuId ?? 'Default'),
      originalPrice: avPriceStr,
      sku: av.skuId,
      variantSelections: Object.keys(variantSelections).length ? variantSelections : undefined,
      available: true,
      metadata: { source: 'reebelo', skuId: av.skuId, offerId: av.offerId },
    });
  }

  return {
    title,
    price,
    currency: 'USD',
    brand: product.brand?.name?.trim() || undefined,
    availability,
    asin: pp.skuId ?? selectedSku?.id,
    images,
    description: description || undefined,
    variants,
    configurationPrices,
    metadata: {
      source: 'reebelo',
      productId: pp.productId ?? product.id,
      psku: product.psku,
      category: product.category?.name,
      vendor: selectedSku?.offers?.[0]?.vendor?.name ?? null,
      buyerProtectionFeeCents: selectedSku?.offers?.[0]?.priceComponents
        ?.find((c: any) => c.name === 'buyer_protection_fee')?.price ?? null,
    },
  };
}

// ── Print helpers ─────────────────────────────────────────────────────────────

function printResult(result: any, source: string) {
  console.log(`\n── Extracted product (${source}) ─────────────────────────────`);
  console.log('  title       :', result.title);
  console.log('  brand       :', result.brand ?? '—');
  console.log('  price       :', result.price, result.currency);
  console.log('  availability:', result.availability);
  console.log('  asin (skuId):', result.asin ?? '—');
  console.log('  images      :', result.images.length, 'urls');
  if (result.images[0]) console.log('  first img   :', result.images[0].slice(0, 90));
  console.log('  description :', (result.description ?? '—').slice(0, 120).replace(/\n/g, ' '));
  console.log('  vendor      :', result.metadata?.vendor ?? '—');
  console.log('  category    :', result.metadata?.category ?? '—');
  console.log('  protection  :', result.metadata?.buyerProtectionFeeCents != null
    ? `$${(result.metadata.buyerProtectionFeeCents / 100).toFixed(2)}`
    : '—');

  console.log('\n── Variants ──────────────────────────────────────────────────');
  for (const v of result.variants) {
    console.log(`  ${v.name}: [${v.options.join(', ')}]`);
  }

  console.log('\n── configurationPrices ───────────────────────────────────────');
  if (!result.configurationPrices.length) {
    console.log('  (none)');
  }
  for (const row of result.configurationPrices) {
    const avail = row.available ? 'in_stock' : 'oos';
    console.log(`  ${String(row.label).padEnd(60)} $${String(row.originalPrice).padStart(8)}  ${avail}`);
  }

  console.log('\n── Full JSON ─────────────────────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { readFileSync } = await import('fs');
  const { resolve } = await import('path');

  console.log('\n══ Reebelo Adapter Test ═════════════════════════════════════');

  // ── Path 1: local reebelo.html ────────────────────────────────────────────
  const localPath = resolve(process.cwd(), 'rebeelo.html');
  try {
    const html = readFileSync(localPath, 'utf8');
    console.log(`\n══ Path 1: local rebeelo.html (${html.length.toLocaleString()} bytes) ════`);
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const result = parseNextData(m[1]);
      if (result) {
        printResult(result, 'local');
      } else {
        console.error('  parseNextData returned null from local file');
      }
    } else {
      console.log('  __NEXT_DATA__ not found in local file');
    }
  } catch {
    console.log('  rebeelo.html not found — skipping local parse');
  }

  // ── Path 2: live scrape via scrape.do ─────────────────────────────────────
  console.log(`\n══ Path 2: Live scrape ══════════════════════════════════════`);
  console.log(`  url: ${URL_TO_TEST}`);

  const token = process.env.SCRAPE_DO_TOKEN?.trim();
  if (!token) {
    console.log('  SCRAPE_DO_TOKEN not set — skipping live scrape');
    console.log('\n══ Done ═════════════════════════════════════════════════════\n');
    return;
  }

  console.log('  SCRAPE_DO_TOKEN found — fetching via scrape.do…');
  let liveHtml: string | null = null;
  try {
    const params = new URLSearchParams({ token, url: URL_TO_TEST, super: 'true', wait: '3000', render: 'true' });
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
          printResult(result, 'live');
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
