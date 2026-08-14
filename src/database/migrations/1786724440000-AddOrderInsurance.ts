import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderInsurance1786724440000 implements MigrationInterface {
  name = 'AddOrderInsurance1786724440000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "insurance" DECIMAL(14,2) NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "insurance"
    `);
  }
}
