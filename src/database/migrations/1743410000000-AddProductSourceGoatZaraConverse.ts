import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `goat`, `zara`, `converse` to PostgreSQL enums for `products.source` and `imported_products.source`.
 */
export class AddProductSourceGoatZaraConverse1743410000000
  implements MigrationInterface
{
  name = 'AddProductSourceGoatZaraConverse1743410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const v of ['goat', 'zara', 'converse'] as const) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TYPE "products_source_enum" ADD VALUE '${v}';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TYPE "imported_products_source_enum" ADD VALUE '${v}';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    /* PostgreSQL cannot drop enum values safely. */
  }
}
