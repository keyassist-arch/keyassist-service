import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderNumber1786724450000 implements MigrationInterface {
  name = 'AddOrderNumber1786724450000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "order_number" VARCHAR(32) UNIQUE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_order_number" ON "orders" ("order_number")
    `);
    await queryRunner.query(`
      UPDATE "orders"
      SET "order_number" = 'KAO-' || UPPER(SUBSTRING(REPLACE("id"::text, '-', ''), 1, 6))
      WHERE "order_number" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_orders_order_number"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "order_number"
    `);
  }
}
