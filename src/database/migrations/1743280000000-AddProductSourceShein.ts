import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `shein` to PostgreSQL enums used by `products.source` and `imported_products.source`.
 * TypeORM default type names: `{table}_{column}_enum`.
 */
export class AddProductSourceShein1743280000000 implements MigrationInterface {
  name = 'AddProductSourceShein1743280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "products_source_enum" ADD VALUE 'shein';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "imported_products_source_enum" ADD VALUE 'shein';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    /* PostgreSQL cannot drop enum values safely; leave `shein` in place. */
  }
}
