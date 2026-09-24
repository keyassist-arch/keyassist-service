import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lagos office pickup, doorstep delivery within Lagos and delivery outside
 * Lagos were all priced at $5.50/lb after 1786724439000 unified the air rate.
 * Pickup is free of local delivery charges; the two delivery options are not.
 */
export class SplitLagosShippingRates1790000000000 implements MigrationInterface {
  name = 'SplitLagosShippingRates1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipping_rates"
        ADD COLUMN IF NOT EXISTS "air_rate_lagos_pickup_per_lb" numeric(10,2) NOT NULL DEFAULT 5.50
    `);
    await queryRunner.query(`
      UPDATE "shipping_rates"
      SET "air_rate_lagos_pickup_per_lb" = 5.50,
          "air_rate_lagos_per_lb" = 6.00,
          "air_rate_outside_lagos_per_lb" = 6.50
      WHERE "id" = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "shipping_rates"
      SET "air_rate_lagos_per_lb" = 5.50,
          "air_rate_outside_lagos_per_lb" = 5.50
      WHERE "id" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "shipping_rates" DROP COLUMN IF EXISTS "air_rate_lagos_pickup_per_lb"
    `);
  }
}
