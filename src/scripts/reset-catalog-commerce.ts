/**
 * Deletes all orders (and tracking), empties carts, unlinks import rows from products,
 * then deletes all products. Users and auth are untouched.
 *
 * Safety: set CONFIRM_RESET=catalog in the environment before running.
 *
 * Usage: CONFIRM_RESET=catalog pnpm run db:reset-catalog
 */
import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: resolve(process.cwd(), '.env') });

async function main() {
  if (process.env.CONFIRM_RESET !== 'catalog') {
    console.error(
      'Refusing to run: set CONFIRM_RESET=catalog (this wipes products, orders, carts).',
    );
    process.exit(1);
  }

  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';

  const ds = new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
  });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await qr.query(`DELETE FROM "order_tracking"`);
    await qr.query(`DELETE FROM "order_items"`);
    await qr.query(`DELETE FROM "orders"`);
    await qr.query(`DELETE FROM "cart_items"`);
    await qr.query(
      `UPDATE "imported_products" SET "product_id" = NULL WHERE "product_id" IS NOT NULL`,
    );
    await qr.query(`DELETE FROM "products"`);
    await qr.commitTransaction();
    console.log(
      'Done: order_tracking, order_items, orders, cart_items cleared; imported_products unlinked; products deleted.',
    );
  } catch (e) {
    await qr.rollbackTransaction();
    console.error(e);
    process.exitCode = 1;
  } finally {
    await qr.release();
    await ds.destroy();
  }
}

void main();
