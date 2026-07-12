import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWannaBuyItemEstimateQuote1783950000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        ADD COLUMN IF NOT EXISTS "is_estimate_quote" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "charged_total_usd" DECIMAL(14,2) NULL,
        ADD COLUMN IF NOT EXISTS "quote_finalized_at" TIMESTAMPTZ NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        DROP COLUMN IF EXISTS "is_estimate_quote",
        DROP COLUMN IF EXISTS "charged_total_usd",
        DROP COLUMN IF EXISTS "quote_finalized_at"
    `);
  }
}
