import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDiscountSettings1790100000000 implements MigrationInterface {
  name = 'CreateDiscountSettings1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount_settings" (
        "id"                              int           NOT NULL DEFAULT 1,
        "first_order_discount_rate"       numeric(5,4)  NOT NULL DEFAULT 0,
        "volume_discount_rate"            numeric(5,4)  NOT NULL DEFAULT 0,
        "volume_discount_threshold_usd"   numeric(10,2) NOT NULL DEFAULT 1000.00,
        "updated_at"                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_discount_settings" PRIMARY KEY ("id"),
        CONSTRAINT "discount_settings_single_row" CHECK (id = 1)
      )
    `);

    // Discounts start disabled (all rates 0); admins turn them on from the panel.
    await queryRunner.query(`
      INSERT INTO "discount_settings" ("id") VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discount_settings"`);
  }
}
