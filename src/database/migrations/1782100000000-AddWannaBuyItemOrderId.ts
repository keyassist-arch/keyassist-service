import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWannaBuyItemOrderId1782100000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        ADD COLUMN IF NOT EXISTS "order_id" uuid NULL,
        ADD CONSTRAINT "fk_wbi_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wanna_buy_items_order"
        ON "wanna_buy_items" ("order_id")
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "idx_wanna_buy_items_order"`);
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        DROP CONSTRAINT IF EXISTS "fk_wbi_order",
        DROP COLUMN IF EXISTS "order_id"
    `);
  }
}
