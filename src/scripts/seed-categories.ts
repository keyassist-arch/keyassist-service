/**
 * Idempotently inserts the default category set.
 * Safe to run multiple times — existing rows are left untouched.
 *
 * Usage: pnpm run seed:categories
 */
import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: resolve(process.cwd(), '.env') });

const DEFAULT_CATEGORIES = [
  {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Phones, laptops, tablets, cameras, gaming and other tech products',
    position: 0,
  },
  {
    name: 'Sneakers',
    slug: 'sneakers',
    description: 'Lifestyle and performance footwear from top brands',
    position: 1,
  },
  {
    name: 'Fashion & Apparel',
    slug: 'fashion-apparel',
    description: 'Clothing, accessories and fashion from global retailers',
    position: 2,
  },
  {
    name: 'Sports & Outdoors',
    slug: 'sports-outdoors',
    description: 'Athletic gear, fitness equipment and outdoor products',
    position: 3,
  },
  {
    name: 'General',
    slug: 'general',
    description: 'Everything else from our global marketplace catalog',
    position: 4,
  },
];

async function main() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';

  const ds = new DataSource({ type: 'postgres', url, synchronize: false });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();

  let created = 0;
  let skipped = 0;

  for (const cat of DEFAULT_CATEGORIES) {
    const existing = await qr.query(
      `SELECT id FROM categories WHERE slug = $1 LIMIT 1`,
      [cat.slug],
    );
    if (existing.length > 0) {
      console.log(`  skip  "${cat.name}" (already exists)`);
      skipped++;
      continue;
    }
    await qr.query(
      `INSERT INTO categories (id, name, slug, description, position, created_at, updated_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, now(), now())`,
      [cat.name, cat.slug, cat.description, cat.position],
    );
    console.log(`  create "${cat.name}"`);
    created++;
  }

  await qr.release();
  await ds.destroy();
  console.log(`\nDone: ${created} created, ${skipped} skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
