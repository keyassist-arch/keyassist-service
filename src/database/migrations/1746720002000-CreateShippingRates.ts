import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShippingRates1746720002000 implements MigrationInterface {
  name = 'CreateShippingRates1746720002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipping_rates" (
        "id"                              int         NOT NULL DEFAULT 1,
        "air_rate_lagos_per_lb"           numeric(10,2) NOT NULL DEFAULT 5.00,
        "air_rate_outside_lagos_per_lb"   numeric(10,2) NOT NULL DEFAULT 6.00,
        "dim_divisor"                     int           NOT NULL DEFAULT 166,
        "air_minimum_lagos"               numeric(10,2) NOT NULL DEFAULT 75.00,
        "air_minimum_outside_lagos"       numeric(10,2) NOT NULL DEFAULT 100.00,
        "min_weight_lbs"                  numeric(10,2) NOT NULL DEFAULT 15.00,
        "bulk_commercial_surcharge"       numeric(10,2) NOT NULL DEFAULT 100.00,
        "tv_clearing_fee"                 numeric(10,2) NOT NULL DEFAULT 300.00,
        "ocean_small_box_rate"            numeric(10,2) NOT NULL DEFAULT 100.00,
        "updated_at"                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipping_rates" PRIMARY KEY ("id"),
        CONSTRAINT "shipping_rates_single_row" CHECK (id = 1)
      )
    `);

    await queryRunner.query(`
      INSERT INTO "shipping_rates" (
        "id",
        "air_rate_lagos_per_lb",
        "air_rate_outside_lagos_per_lb",
        "dim_divisor",
        "air_minimum_lagos",
        "air_minimum_outside_lagos",
        "min_weight_lbs",
        "bulk_commercial_surcharge",
        "tv_clearing_fee",
        "ocean_small_box_rate"
      ) VALUES (1, 5.00, 6.00, 166, 75.00, 100.00, 15.00, 100.00, 300.00, 100.00)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shipping_rates"`);
  }
}
