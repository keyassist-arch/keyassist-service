import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductObservedTaxAmount1780900000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "observed_tax_amount_usd"
          DECIMAL(14, 2) DEFAULT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "observed_tax_amount_usd"
    `);
  }
}
