import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserEmailVerifiedAt1743400000000 implements MigrationInterface {
  name = 'AddUserEmailVerifiedAt1743400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      UPDATE "users"
      SET "email_verified_at" = COALESCE("created_at", NOW())
      WHERE "email_verified_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at"
    `);
  }
}
