import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedPaymentMethods1780800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(255) NULL
    `);
    await runner.query(`
      CREATE TABLE IF NOT EXISTS "saved_payment_methods" (
        "id"                       uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"                  uuid         NOT NULL,
        "provider"                 varchar(32)  NOT NULL,
        "type"                     varchar(16)  NULL,
        "label"                    varchar(128) NOT NULL,
        "brand"                    varchar(64)  NULL,
        "last4"                    varchar(4)   NULL,
        "expiry_month"             smallint     NULL,
        "expiry_year"              smallint     NULL,
        "stripe_payment_method_id" varchar(255) NULL,
        "stripe_customer_id"       varchar(255) NULL,
        "paypal_payment_token_id"  varchar(255) NULL,
        "paypal_email"             varchar(255) NULL,
        "is_default"               boolean      NOT NULL DEFAULT false,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_saved_payment_methods" PRIMARY KEY ("id"),
        CONSTRAINT "fk_saved_payment_methods_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "idx_saved_payment_methods_user"
        ON "saved_payment_methods" ("user_id")
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "idx_saved_payment_methods_user"`);
    await runner.query(`DROP TABLE IF EXISTS "saved_payment_methods"`);
    await runner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "stripe_customer_id"
    `);
  }
}
