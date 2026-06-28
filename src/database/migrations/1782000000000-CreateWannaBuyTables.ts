import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWannaBuyTables1782000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TYPE "batch_status_enum" AS ENUM (
        'collecting', 'processing', 'placing_orders',
        'in_transit', 'at_warehouse', 'shipped', 'delivered', 'cancelled'
      )
    `);

    await runner.query(`
      CREATE TYPE "wanna_buy_item_status_enum" AS ENUM (
        'pending', 'quoted', 'confirmed', 'paid', 'ordered', 'cancelled', 'expired'
      )
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS "batches" (
        "id"                     uuid           NOT NULL DEFAULT uuid_generate_v4(),
        "status"                 batch_status_enum NOT NULL DEFAULT 'collecting',
        "label"                  varchar(128)   NULL,
        "processing_started_at"  TIMESTAMPTZ    NULL,
        "placing_orders_at"      TIMESTAMPTZ    NULL,
        "in_transit_at"          TIMESTAMPTZ    NULL,
        "at_warehouse_at"        TIMESTAMPTZ    NULL,
        "shipped_at"             TIMESTAMPTZ    NULL,
        "delivered_at"           TIMESTAMPTZ    NULL,
        "created_at"             TIMESTAMPTZ    NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_batches" PRIMARY KEY ("id")
      )
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS "wanna_buy_items" (
        "id"                uuid                        NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"           uuid                        NOT NULL,
        "batch_id"          uuid                        NULL,
        "product_url"       varchar(2048)               NOT NULL,
        "product_title"     varchar(512)                NULL,
        "image_url"         varchar(2048)               NULL,
        "marketplace"       varchar(64)                 NULL,
        "variant_selection" jsonb                       NULL,
        "status"            wanna_buy_item_status_enum  NOT NULL DEFAULT 'pending',
        "scraped_price_usd" NUMERIC(14, 2)              NULL,
        "admin_price_usd"   NUMERIC(14, 2)              NULL,
        "price_edit_note"   varchar(512)                NULL,
        "tax_amount_usd"    NUMERIC(14, 2)              NULL,
        "platform_fee_usd"  NUMERIC(14, 2)              NULL,
        "kingz_shipping_usd" NUMERIC(14, 2)             NULL,
        "fx_buffer_usd"     NUMERIC(14, 2)              NULL,
        "total_usd"         NUMERIC(14, 2)              NULL,
        "total_ngn"         NUMERIC(18, 2)              NULL,
        "notified_at"       TIMESTAMPTZ                 NULL,
        "confirmed_at"      TIMESTAMPTZ                 NULL,
        "paid_at"           TIMESTAMPTZ                 NULL,
        "created_at"        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
        CONSTRAINT "pk_wanna_buy_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wbi_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_wbi_batch"
          FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wanna_buy_items_user"
        ON "wanna_buy_items" ("user_id")
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wanna_buy_items_batch"
        ON "wanna_buy_items" ("batch_id")
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wanna_buy_items_status"
        ON "wanna_buy_items" ("status")
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "idx_wanna_buy_items_status"`);
    await runner.query(`DROP INDEX IF EXISTS "idx_wanna_buy_items_batch"`);
    await runner.query(`DROP INDEX IF EXISTS "idx_wanna_buy_items_user"`);
    await runner.query(`DROP TABLE IF EXISTS "wanna_buy_items"`);
    await runner.query(`DROP TABLE IF EXISTS "batches"`);
    await runner.query(`DROP TYPE IF EXISTS "wanna_buy_item_status_enum"`);
    await runner.query(`DROP TYPE IF EXISTS "batch_status_enum"`);
  }
}
