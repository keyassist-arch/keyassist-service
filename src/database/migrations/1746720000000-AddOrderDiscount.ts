import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderDiscount1746720000000 implements MigrationInterface {
  name = 'AddOrderDiscount1746720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "discount" numeric(14,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "discount"
    `);
  }
}
