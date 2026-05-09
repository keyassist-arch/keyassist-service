/**
 * Quick local test: serves nike.html via a tiny HTTP server, then runs the
 * NikeAdapter extraction logic (including stealth Playwright) against it.
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/scripts/test-nike-scrape.ts
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

// ── Inline the extraction helpers (mirrors nike.adapter.ts) ─────────────────

interface NikeImageProps {
  squarish?: { url: string };
  portrait?: { url: string };
  landscape?: { url: string };
}
interface NikeContentImage {
  properties?: NikeImageProps;
}
interface NikeSize {
  label: string;
  status?: string;
  skuId?: string;
}
interface NikePrices {
  currency?: string;
  currentPrice?: number;
}
interface NikeProductInfo {
  title?: string;
  subtitle?: string;
  fullTitle?: string;
  productDescription?: string;
  featuresAndBenefits?: string[];
}
interface NikeSelectedProduct {
  contentImages?: NikeContentImage[];
  prices?: NikePrices;
  sizes?: NikeSize[];
  colorDescription?: string;
  styleColor?: string;
  statusModifier?: string;
  productInfo?: NikeProductInfo;
}

function findSelectedProduct(
  root: Record<string, unknown>,
): NikeSelectedProduct | null {
  const get = (obj: unknown, ...keys: string[]): unknown => {
    let cur = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
  };
  const looksLike = (o: unknown) => {
    if (o == null || typeof o !== 'object') return false;
    const x = o as Record<string, unknown>;
    return (
      typeof (x.prices as Record<string, unknown>)?.currentPrice === 'number' ||
      typeof x.styleColor === 'string'
    );
  };

  const p1 = get(root, 'props', 'pageProps', 'initialState', 'selectedProduct');
  if (looksLike(p1)) return p1 as NikeSelectedProduct;

  const p2 = get(root, 'props', 'pageProps', 'selectedProduct');
  if (looksLike(p2)) return p2 as NikeSelectedProduct;

  const threadsProducts = get(
    root,
    'props',
    'pageProps',
    'initialState',
    'Threads',
    'products',
  );
  if (threadsProducts && typeof threadsProducts === 'object') {
    const first = Object.values(threadsProducts as Record<string, unknown>)[0];
    if (looksLike(first)) return first as NikeSelectedProduct;
  }
  return null;
}

function extractImages(
  contentImages?: NikeContentImage[],
  ogImage?: string | null,
): string[] {
  const pick = (img: NikeContentImage) =>
    img.properties?.squarish?.url ||
    img.properties?.portrait?.url ||
    img.properties?.landscape?.url;
  const urls: string[] = [];
  for (const img of contentImages ?? []) {
    const u = pick(img);
    if (u) urls.push(u);
  }
  if (urls.length === 0 && ogImage) urls.push(ogImage);
  return [...new Set(urls)].slice(0, 20);
}

// ── Serve nike.html ──────────────────────────────────────────────────────────

async function startServer(): Promise<{ url: string; close: () => void }> {
  const html = fs.readFileSync(path.resolve('nike.html'));
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { url, close } = await startServer();
  console.log(`Serving nike.html at ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

    // Mirror the waitForFunction from the adapter
    await page
      .waitForFunction(
        () => {
          const el = document.getElementById('__NEXT_DATA__');
          if (!el?.textContent) return false;
          try {
            const d = JSON.parse(el.textContent) as Record<string, unknown>;
            const pp = (d?.props as Record<string, unknown>)
              ?.pageProps as Record<string, unknown>;
            const state = pp?.initialState as Record<string, unknown>;
            const sel = state?.selectedProduct as Record<string, unknown>;
            const prices = sel?.prices as Record<string, unknown>;
            return typeof prices?.currentPrice === 'number';
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .catch(() => console.warn('waitForFunction timed out'));

    const raw = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return {
        nextDataJson: el?.textContent ?? null,
         ogImage:
           (
             document.querySelector(
               'meta[property="og:image"]',
             ) as HTMLMetaElement | null
           )?.content ?? null,
        titleFallback:
          document
            .querySelector('[data-testid="product_title"]')
            ?.textContent?.trim() ??
          document.querySelector('h1')?.textContent?.trim() ??
          null,
      };
    });

    console.log(
      `\n__NEXT_DATA__ present: ${raw.nextDataJson != null}, length: ${raw.nextDataJson?.length ?? 0}`,
    );
    console.log(`og:image: ${raw.ogImage}`);
    console.log(`title fallback: ${raw.titleFallback}`);

    if (!raw.nextDataJson) {
      console.error('No __NEXT_DATA__ found — extraction will fail');
      return;
    }

    const root = JSON.parse(raw.nextDataJson) as Record<string, unknown>;
    const selected = findSelectedProduct(root);

    if (!selected) {
      console.error('selectedProduct not found in __NEXT_DATA__');
      return;
    }

    const prices = selected.prices;
    const info = selected.productInfo;
    const images = extractImages(selected.contentImages, raw.ogImage);

    console.log('\n── Extracted product ───────────────────────────────────');
    console.log(
      'title       :',
      info?.fullTitle || info?.title || raw.titleFallback,
    );
    console.log('price       :', prices?.currentPrice, prices?.currency);
    console.log('styleColor  :', selected.styleColor);
    console.log('color       :', selected.colorDescription);
    console.log('availability:', selected.statusModifier);
    console.log('images      :', images.length, 'URLs');
    images.slice(0, 3).forEach((u, i) => console.log(`  [${i}]`, u));
    if (images.length > 3) console.log(`  ... and ${images.length - 3} more`);
    console.log(
      'sizes       :',
      (selected.sizes ?? []).map((s) => `${s.label}(${s.status})`).join(', '),
    );
    console.log(
      'description :',
      (info?.productDescription ?? '').slice(0, 120) + '...',
    );
    console.log(
      'features    :',
      (info?.featuresAndBenefits ?? []).length,
      'items',
    );
  } finally {
    await context.close();
    await browser.close();
    close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
