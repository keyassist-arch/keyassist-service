import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductRescrapeEnabled1743130800000 implements MigrationInterface {
  name = 'AddProductRescrapeEnabled1743130800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "stock_quantity" integer NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "rescrape_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_products_rescrape"
      ON "products" ("rescrape_enabled", "last_scraped_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_rescrape"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "rescrape_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_quantity"`,
    );
  }
}
