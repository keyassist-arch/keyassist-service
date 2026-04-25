import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the reconciliation tables:
 *   - `refunds`          — one refund row per refund attempt, linked to an order
 *   - `customer_issues`  — support tickets linked to an order and/or user
 */
export class AddReconciliationTables1743800000000 implements MigrationInterface {
  name = 'AddReconciliationTables1743800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE refund_status_enum AS ENUM (
          'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_REQUIRED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE issue_type_enum AS ENUM (
          'PAYMENT_DISPUTE', 'REFUND_REQUEST', 'ITEM_NOT_RECEIVED',
          'WRONG_ITEM', 'DAMAGED_ITEM', 'BILLING_ERROR', 'OTHER'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE issue_status_enum AS ENUM (
          'OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE issue_priority_enum AS ENUM (
          'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // refunds table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refunds" (
        "id"                 UUID                NOT NULL DEFAULT gen_random_uuid(),
        "order_id"           UUID                NOT NULL,
        "amount"             NUMERIC(14,2)       NOT NULL,
        "currency"           character varying(8) NOT NULL,
        "status"             refund_status_enum  NOT NULL DEFAULT 'PENDING',
        "reason"             character varying(512) NULL,
        "internal_note"      character varying(1024) NULL,
        "provider_refund_id" character varying   NULL,
        "provider_response"  JSONB               NULL,
        "initiated_by"       UUID                NULL,
        "failed_reason"      character varying   NULL,
        "created_at"         TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refunds_order"
          FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refunds_order_id"
      ON "refunds" ("order_id")
    `);

    // customer_issues table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_issues" (
        "id"              UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "order_id"        UUID                  NULL,
        "user_id"         UUID                  NOT NULL,
        "type"            issue_type_enum       NOT NULL DEFAULT 'OTHER',
        "status"          issue_status_enum     NOT NULL DEFAULT 'OPEN',
        "priority"        issue_priority_enum   NOT NULL DEFAULT 'MEDIUM',
        "subject"         character varying(256) NOT NULL,
        "description"     TEXT                  NOT NULL,
        "resolution_note" TEXT                  NULL,
        "internal_note"   TEXT                  NULL,
        "refund_id"       UUID                  NULL,
        "assigned_to"     UUID                  NULL,
        "resolved_at"     TIMESTAMPTZ           NULL,
        "created_at"      TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_issues" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_issues_order"
          FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_customer_issues_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_customer_issues_user_id"
      ON "customer_issues" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_customer_issues_order_id"
      ON "customer_issues" ("order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_customer_issues_status"
      ON "customer_issues" ("status")
    `);

    // Patch orders table to include REFUNDED and DISPUTED statuses
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "public"."orders_status_enum"
          ADD VALUE IF NOT EXISTS 'REFUNDED';
      EXCEPTION WHEN others THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "public"."orders_status_enum"
          ADD VALUE IF NOT EXISTS 'DISPUTED';
      EXCEPTION WHEN others THEN NULL; END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_customer_issues_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_customer_issues_order_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_customer_issues_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_issues"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refunds_order_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refunds"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "issue_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "issue_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "issue_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "refund_status_enum"`);
  }
}
