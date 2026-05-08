import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSavedProducts1746720003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "saved_products" (
        "id"         uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    uuid              NOT NULL,
        "product_id" uuid              NOT NULL,
        "created_at" TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "pk_saved_products" PRIMARY KEY ("id"),
        CONSTRAINT "uq_saved_products_user_product" UNIQUE ("user_id", "product_id"),
        CONSTRAINT "fk_saved_products_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_saved_products_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_saved_products_user" ON "saved_products" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "saved_products"`);
  }
}
