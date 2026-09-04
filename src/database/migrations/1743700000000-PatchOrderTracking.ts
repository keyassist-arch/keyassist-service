import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three changes to `order_tracking`:
 *   1. Rename column `updated_at` → `created_at` (rows are append-only; the old
 *      name was a semantic mistake — the value never changed after insert).
 *   2. Make `carrier` and `tracking_number` nullable (a status-only event, e.g.
 *      "Out for delivery", need not carry a carrier change).
 *   3. Add `message` column for a human-readable note shown to the customer.
 */
export class PatchOrderTracking1743700000000 implements MigrationInterface {
  name = 'PatchOrderTracking1743700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename updated_at → created_at (only on existing DBs; fresh installs already have created_at)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'order_tracking' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE "order_tracking" RENAME COLUMN "updated_at" TO "created_at";
        END IF;
      END $$
    `);

    // 2. Make carrier and tracking_number nullable (they may already be nullable
    //    depending on the initial schema; the IF EXISTS guards make this safe).
    await queryRunner.query(`
      ALTER TABLE "order_tracking"
        ALTER COLUMN "carrier" DROP NOT NULL,
        ALTER COLUMN "tracking_number" DROP NOT NULL
    `);

    // 3. Add message column
    await queryRunner.query(`
      ALTER TABLE "order_tracking"
      ADD COLUMN IF NOT EXISTS "message" character varying(512) NULL
    `);

    // 4. Add index on order_id for fast per-order event lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_tracking_order_id"
      ON "order_tracking" ("order_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_order_tracking_order_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "order_tracking" DROP COLUMN IF EXISTS "message"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_tracking"
        ALTER COLUMN "carrier" SET NOT NULL,
        ALTER COLUMN "tracking_number" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "order_tracking"
      RENAME COLUMN "created_at" TO "updated_at"
    `);
  }
}
