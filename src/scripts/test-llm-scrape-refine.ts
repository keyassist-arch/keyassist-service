/**
 * End-to-end smoke test for LLM scrape refinement.
 *
 * Scrapes a product URL, prints the raw adapter output, runs it through
 * ScrapeRefinementService (which calls the configured LLM), then prints
 * the refined output side-by-side so you can verify gemini-2.5-pro is working.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-llm-scrape-refine.ts [url]
 *
 * Defaults to an Amazon product if no URL is given.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import type { ScrapedProduct } from '../scraper/interfaces/scraped-product.interface';
import { parsePriceToDecimalString } from '../scraper/utils/normalize-price.util';

// ── Config ────────────────────────────────────────────────────────────────────

const TEST_URL =
  process.argv[2] ??
  'https://www.amazon.com/dp/B0CHX2FKQB'; // Apple AirPods Pro 2

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() ?? 'gemini-2.5-flash';
const TIMEOUT_MS = 45_000;

// ── Minimal HTML fetch ────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const { data } = await axios.get<string>(url, {
    timeout: TIMEOUT_MS,
    maxContentLength: 4_000_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: (s) => s < 400,
  });
  return data;
}

// ── Generic HTML → ScrapedProduct ────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGeneric(html: string, url: string): ScrapedProduct {
  const titleMatch =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 300)
    : url;

  const priceMatch =
    html.match(/itemprop="price"[^>]+content="([\d.,]+)"/i) ??
    html.match(/"priceAmount":"?([\d.]+)"?/i) ??
    html.match(/\$([\d,]+\.?\d{2})/);
  const rawPrice = priceMatch ? priceMatch[1].replace(/,/g, '') : '0';
  const price = parsePriceToDecimalString(rawPrice) ?? '0';

  const currencyMatch =
    html.match(/itemprop="priceCurrency"[^>]+content="([A-Z]{3})"/i) ??
    html.match(/"currency":"([A-Z]{3})"/i);
  const currency = currencyMatch ? currencyMatch[1] : 'USD';

  const brandMatch =
    html.match(/"brand"\s*:\s*\{\s*"@type"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"([^"]+)"/i) ??
    html.match(/<meta[^>]+name="brand"[^>]+content="([^"]+)"/i);
  const brand = brandMatch ? brandMatch[1].trim() : undefined;

  const descMatch =
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ??
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  const description = descMatch ? descMatch[1].trim() : undefined;

  const images: string[] = [];
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (ogImage) images.push(ogImage[1]);

  return { title, price, currency, images, description, brand, variants: [] };
}

// ── LLM refinement prompt (mirrors ScrapeRefinementService) ──────────────────

function buildPrompt(url: string, scraped: ScrapedProduct, pageText: string): string {
  const base = JSON.stringify(scraped, null, 2);
  return `You are a strict product-data normalizer and copywriter for e-commerce.

URL: ${url}

VISIBLE_PAGE_TEXT (may be partial; use as ground truth for prices/sizes when it conflicts with ADAPTER_JSON):
${pageText.slice(0, 16_000)}

ADAPTER_JSON (from site-specific scraper — may have wrong prices or misaligned variant rows):
${base}

Task: Return ONE JSON object with the SAME schema as ADAPTER_JSON (ScrapedProduct). Fix:
- Base price and currency to match the real selling price for the default/selected variant when possible.
- currency must be a correct ISO 4217 3-letter code (e.g. USD, NGN, GBP, EUR).
- variants[].name and variants[].options must list every selectable axis and values.
- description: Write 2–4 sentences of clear, factual product copy covering key features, materials, intended use, and notable specs. Do not invent specs not present in the source data.
- Do NOT invent prices: if unsure, keep the adapter value.
- If you cannot improve data, return ADAPTER_JSON unchanged.

Return ONLY valid JSON, no markdown.`;
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function printDiff(before: ScrapedProduct, after: ScrapedProduct): void {
  const fields: Array<keyof ScrapedProduct> = [
    'title', 'price', 'currency', 'brand', 'description', 'availability',
  ];
  for (const f of fields) {
    const b = String(before[f] ?? '—').slice(0, 120);
    const a = String(after[f] ?? '—').slice(0, 120);
    const changed = b !== a;
    const tag = changed ? '  CHANGED' : '         ';
    console.log(`${tag}  ${f}:`);
    if (changed) {
      console.log(`           before: ${b}`);
      console.log(`           after : ${a}`);
    } else {
      console.log(`           = ${b}`);
    }
  }
  const varsBefore = before.variants?.length ?? 0;
  const varsAfter = after.variants?.length ?? 0;
  console.log(`\n  variants : ${varsBefore} → ${varsAfter}`);
  if (varsAfter > 0) {
    for (const v of after.variants!) {
      console.log(`    ${v.name}: [${v.options.slice(0, 6).join(', ')}${v.options.length > 6 ? '…' : ''}]`);
    }
  }
  const rowsBefore = before.configurationPrices?.length ?? 0;
  const rowsAfter = after.configurationPrices?.length ?? 0;
  console.log(`  configRows: ${rowsBefore} → ${rowsAfter}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n══ LLM Scrape Refinement Test ═══════════════════════════════`);
  console.log(`  model : ${GEMINI_MODEL}`);
  console.log(`  url   : ${TEST_URL}\n`);

  if (!GEMINI_API_KEY) {
    console.error('  ERROR: GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  // 1. Fetch page
  console.log('── Step 1: Fetching page HTML…');
  let html: string;
  try {
    html = await fetchHtml(TEST_URL);
    console.log(`  OK — ${html.length.toLocaleString()} bytes`);
  } catch (e) {
    console.error('  Fetch failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // 2. Parse into ScrapedProduct
  console.log('\n── Step 2: Parsing with generic adapter…');
  const rawProduct = parseGeneric(html, TEST_URL);
  console.log('  title   :', rawProduct.title);
  console.log('  price   :', rawProduct.price, rawProduct.currency);
  console.log('  brand   :', rawProduct.brand ?? '—');
  console.log('  desc    :', rawProduct.description?.slice(0, 100) ?? '—');
  console.log('  images  :', rawProduct.images.length);

  // 3. Call Gemini
  console.log('\n── Step 3: Calling Gemini for LLM refinement…');
  const pageText = stripHtml(html);
  const prompt = buildPrompt(TEST_URL, rawProduct, pageText);

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const t0 = Date.now();
  let rawResponse: string;

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction:
          'You are a strict e-commerce scrape normalizer and product copywriter. Reply with a single JSON object only — no markdown, no code fences, no commentary.',
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });
    rawResponse = response.text?.trim() ?? '';
    const usage = response.usageMetadata;
    const elapsed = Date.now() - t0;
    console.log(`  OK — ${elapsed}ms`);
    if (usage) {
      console.log(
        `  tokens: prompt=${usage.promptTokenCount ?? '?'} ` +
        `completion=${usage.candidatesTokenCount ?? '?'} ` +
        `total=${usage.totalTokenCount ?? '?'}`,
      );
    }
  } catch (e) {
    console.error('  Gemini call failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // 4. Parse LLM JSON
  console.log('\n── Step 4: Parsing LLM response…');
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('  No JSON object found in response.');
    console.log('  Raw response:\n', rawResponse.slice(0, 500));
    process.exit(1);
  }

  let refined: ScrapedProduct;
  try {
    refined = JSON.parse(jsonMatch[0]) as ScrapedProduct;
    console.log('  Parsed OK');
  } catch (e) {
    console.error('  JSON.parse failed:', e instanceof Error ? e.message : e);
    console.log('  Raw response:\n', rawResponse.slice(0, 500));
    process.exit(1);
  }

  // 5. Print diff
  console.log('\n── Step 5: Before → After diff ─────────────────────────────');
  printDiff(rawProduct, refined);

  console.log('\n── Full refined JSON ────────────────────────────────────────');
  console.log(JSON.stringify(refined, null, 2));

  console.log('\n══ Done ═════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
