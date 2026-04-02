import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductSlug1743340000000 implements MigrationInterface {
  name = 'AddProductSlug1743340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "slug" character varying(200)
    `);
    await queryRunner.query(`
      UPDATE "products"
      SET "slug" = "id"::text
      WHERE "slug" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
      ALTER COLUMN "slug" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_slug"
      ON "products" ("slug")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_slug"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "slug"`,
    );
  }
}
