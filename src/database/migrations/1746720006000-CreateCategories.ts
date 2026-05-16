import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1746720006000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "name"        varchar       NOT NULL,
        "slug"        varchar       NOT NULL,
        "description" text,
        "image_url"   varchar,
        "position"    int           NOT NULL DEFAULT 0,
        "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_categories"        PRIMARY KEY ("id"),
        CONSTRAINT "uq_categories_name"   UNIQUE ("name"),
        CONSTRAINT "uq_categories_slug"   UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "category_id" uuid,
        ADD CONSTRAINT "fk_products_category"
          FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_products_category" ON "products" ("category_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_category"`);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "fk_products_category",
        DROP COLUMN IF EXISTS "category_id"
    `);
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
