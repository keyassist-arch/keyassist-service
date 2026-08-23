import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShippingInsuranceAndFixDimDivisor1786724439000
  implements MigrationInterface
{
  name = 'AddShippingInsuranceAndFixDimDivisor1786724439000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipping_rates"
        ADD COLUMN IF NOT EXISTS "cargo_insurance_rate_lagos" numeric(5,4) NOT NULL DEFAULT 0.03
    `);

    // Bring the seeded row in line with the current Kingz technical spec:
    // dim divisor 139 (was 166), and the air rate unified at $5.50/lb for all
    // destinations (the seed row still had the pre-unification 5.00/6.00 split).
    await queryRunner.query(`
      UPDATE "shipping_rates"
      SET "dim_divisor" = 139,
          "air_rate_lagos_per_lb" = 5.50,
          "air_rate_outside_lagos_per_lb" = 5.50
      WHERE "id" = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "shipping_rates"
      SET "dim_divisor" = 166,
          "air_rate_lagos_per_lb" = 5.00,
          "air_rate_outside_lagos_per_lb" = 6.00
      WHERE "id" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "shipping_rates" DROP COLUMN IF EXISTS "cargo_insurance_rate_lagos"
    `);
  }
}
