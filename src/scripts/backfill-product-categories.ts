/**
 * One-shot backfill: assigns a category to every product that currently has category_id = NULL.
 * Products that already have a category are untouched (admin overrides are preserved).
 *
 * Run seed:categories first so the category rows exist.
 *
 * Usage: pnpm run backfill:categories
 */
import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: resolve(process.cwd(), '.env') });

// ─── Classification logic (mirrors CategoryClassifierService) ─────────────────

const SOURCE_SLUG: Record<string, string> = {
  apple: 'electronics',
  nike: 'sneakers',
  stockx: 'sneakers',
  goat: 'sneakers',
  converse: 'sneakers',
  zara: 'fashion-apparel',
  shein: 'fashion-apparel',
};

const ELECTRONICS_RE =
  /\b(phone|laptop|macbook|ipad|iphone|samsung|airpod|headphone|earphone|speaker|computer|monitor|camera|console|gaming|xbox|playstation|ps[0-9]|nintendo|android|pixel|galaxy|smartwatch|tablet|tv|television|drone|router|charger|cable|ssd|gpu|cpu|ram|keyboard|mouse)\b/i;

const SNEAKERS_RE =
  /\b(sneaker|shoe|boot|sandal|trainer|jordan|adidas|yeezy|dunk|air max|chuck|vans|puma|reebok|air force|footwear|cleat|loafer|mule|stiletto|heel|flat|slip.?on)\b/i;

const FASHION_RE =
  /\b(shirt|t-shirt|dress|jeans|denim|jacket|coat|trouser|pant|hoodie|sweater|blouse|skirt|fashion|apparel|clothing|wear|outfit|hat|cap|beanie|handbag|bag|wallet|scarf|glove|swimwear|bikini|lingerie|pyjama)\b/i;

const SPORTS_RE =
  /\b(sport|gym|fitness|running|yoga|cycling|swim|football|soccer|basketball|tennis|golf|hiking|climbing|ski|snowboard|martial art|boxing|wrestling|athletic)\b/i;

function classifySlug(source: string, brand: string | null, title: string): string {
  if (SOURCE_SLUG[source]) return SOURCE_SLUG[source];

  const text = `${brand ?? ''} ${title}`;

  if (ELECTRONICS_RE.test(text)) return 'electronics';
  if (SNEAKERS_RE.test(text)) return 'sneakers';
  if (FASHION_RE.test(text)) return 'fashion-apparel';
  if (SPORTS_RE.test(text)) return 'sports-outdoors';

  return 'general';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';

  const ds = new DataSource({ type: 'postgres', url, synchronize: false });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();

  // Load category slug→id map
  const catRows: { id: string; slug: string }[] = await qr.query(
    `SELECT id, slug FROM categories`,
  );
  if (catRows.length === 0) {
    console.error(
      'No categories found. Run `pnpm run seed:categories` first.',
    );
    await qr.release();
    await ds.destroy();
    process.exit(1);
  }
  const slugToId = new Map(catRows.map((r) => [r.slug, r.id]));
  console.log(`Loaded ${catRows.length} categories.`);

  // Load uncategorised products
  const products: { id: string; source: string; brand: string | null; title: string }[] =
    await qr.query(
      `SELECT id, source, brand, title FROM products WHERE category_id IS NULL`,
    );
  console.log(`Found ${products.length} uncategorised product(s).`);

  if (products.length === 0) {
    await qr.release();
    await ds.destroy();
    console.log('Nothing to backfill.');
    return;
  }

  const tally: Record<string, number> = {};
  let updated = 0;
  let skipped = 0;

  await qr.startTransaction();
  try {
    for (const p of products) {
      const slug = classifySlug(p.source, p.brand, p.title);
      const catId = slugToId.get(slug);
      if (!catId) {
        console.warn(`  SKIP productId=${p.id} — no category row for slug="${slug}"`);
        skipped++;
        continue;
      }
      await qr.query(
        `UPDATE products SET category_id = $1 WHERE id = $2`,
        [catId, p.id],
      );
      tally[slug] = (tally[slug] ?? 0) + 1;
      updated++;
    }
    await qr.commitTransaction();
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  }

  await qr.release();
  await ds.destroy();

  console.log(`\nBackfill complete: ${updated} updated, ${skipped} skipped.`);
  console.log('Category breakdown:');
  for (const [slug, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(20)} ${count}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
