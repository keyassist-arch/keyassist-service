import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderLandedCostColumns1746720005000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "marketplace_tax"      DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "marketplace_shipping"  DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "domestic_handling"    DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "customs_total"        DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "fx_buffer"            DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "risk_buffer"          DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "pricing_breakdown"    JSONB         NOT NULL DEFAULT '[]'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "marketplace_tax",
        DROP COLUMN IF EXISTS "marketplace_shipping",
        DROP COLUMN IF EXISTS "domestic_handling",
        DROP COLUMN IF EXISTS "customs_total",
        DROP COLUMN IF EXISTS "fx_buffer",
        DROP COLUMN IF EXISTS "risk_buffer",
        DROP COLUMN IF EXISTS "pricing_breakdown"
    `);
  }
}
