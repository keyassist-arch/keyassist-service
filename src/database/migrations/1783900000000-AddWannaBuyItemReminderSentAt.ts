import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWannaBuyItemReminderSentAt1783900000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        ADD COLUMN IF NOT EXISTS "reminder_sent_at" TIMESTAMPTZ NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "wanna_buy_items"
        DROP COLUMN IF EXISTS "reminder_sent_at"
    `);
  }
}
