import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchCollectingEndsAt1783800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "batches"
        ADD COLUMN IF NOT EXISTS "collecting_ends_at" TIMESTAMPTZ NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "batches"
        DROP COLUMN IF EXISTS "collecting_ends_at"
    `);
  }
}
