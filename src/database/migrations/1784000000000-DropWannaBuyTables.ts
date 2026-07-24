import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropWannaBuyTables1784000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS "wanna_buy_items"`);
    await runner.query(`DROP TABLE IF EXISTS "batches"`);
    await runner.query(`DROP TYPE IF EXISTS "wanna_buy_item_status_enum"`);
    await runner.query(`DROP TYPE IF EXISTS "batch_status_enum"`);
  }

  async down(): Promise<void> {
    throw new Error(
      'DropWannaBuyTables is not reversible — restore from a backup if the Wanna Buy feature needs to come back.',
    );
  }
}
