import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPhoneVerification1782200000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "phone_otp_code_hash" varchar NULL,
        ADD COLUMN IF NOT EXISTS "phone_otp_expires_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "phone_otp_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "phone_otp_sent_at" timestamptz NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "phone_otp_sent_at",
        DROP COLUMN IF EXISTS "phone_otp_attempts",
        DROP COLUMN IF EXISTS "phone_otp_expires_at",
        DROP COLUMN IF EXISTS "phone_otp_code_hash",
        DROP COLUMN IF EXISTS "phone_verified_at"
    `);
  }
}
