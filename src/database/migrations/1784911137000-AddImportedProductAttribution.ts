import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportedProductAttribution1784911137000
  implements MigrationInterface
{
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "imported_products"
        ADD COLUMN IF NOT EXISTS "requested_by_user_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "order_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "dismissed_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "dismiss_reason" text NULL
    `);
    await runner.query(`
      ALTER TABLE "imported_products"
        ADD CONSTRAINT "FK_imported_products_requested_by_user"
        FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await runner.query(`
      ALTER TABLE "imported_products"
        ADD CONSTRAINT "FK_imported_products_order"
        FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL
    `);
    // Admin queue is always filtered by requested_by_user_id IS NOT NULL AND order_id IS NULL
    // AND dismissed_at IS NULL — index the common lookup path.
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_imported_products_pending_queue"
        ON "imported_products" ("created_at" DESC)
        WHERE "requested_by_user_id" IS NOT NULL AND "order_id" IS NULL AND "dismissed_at" IS NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "IDX_imported_products_pending_queue"`);
    await runner.query(`
      ALTER TABLE "imported_products"
        DROP CONSTRAINT IF EXISTS "FK_imported_products_order",
        DROP CONSTRAINT IF EXISTS "FK_imported_products_requested_by_user"
    `);
    await runner.query(`
      ALTER TABLE "imported_products"
        DROP COLUMN IF EXISTS "dismiss_reason",
        DROP COLUMN IF EXISTS "dismissed_at",
        DROP COLUMN IF EXISTS "order_id",
        DROP COLUMN IF EXISTS "requested_by_user_id"
    `);
  }
}
