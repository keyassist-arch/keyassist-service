import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FAILED imports should not retain product_id from an older successful run;
 * API and markImportFailed now clear it — this fixes existing rows.
 */
export class ClearProductFkOnFailedImports1743200000000 implements MigrationInterface {
  name = 'ClearProductFkOnFailedImports1743200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "imported_products"
      SET "product_id" = NULL
      WHERE "status" = 'FAILED' AND "product_id" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    /* no-op: cannot restore cleared FKs */
  }
}
