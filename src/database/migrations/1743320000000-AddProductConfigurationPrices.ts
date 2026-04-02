import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductConfigurationPrices1743320000000 implements MigrationInterface {
  name = 'AddProductConfigurationPrices1743320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "configuration_prices" jsonb NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "configuration_prices"`,
    );
  }
}
