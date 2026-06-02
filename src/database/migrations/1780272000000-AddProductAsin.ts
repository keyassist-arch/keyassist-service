import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductAsin1780272000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS asin VARCHAR(100) NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE products DROP COLUMN IF EXISTS asin`);
  }
}
