import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdminPermissions1782300000000
  implements MigrationInterface
{
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "admin_disabled_at" timestamptz NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "admin_disabled_at",
        DROP COLUMN IF EXISTS "permissions"
    `);
  }
}
