import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderShippingFee1746720001000 implements MigrationInterface {
  name = 'AddOrderShippingFee1746720001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_fee" numeric(14,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_fee"
    `);
  }
}
