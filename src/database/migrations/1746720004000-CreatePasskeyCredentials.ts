import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasskeyCredentials1746720004000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "passkey_credentials" (
        "id"            uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"       uuid          NOT NULL,
        "credential_id" varchar       NOT NULL,
        "public_key"    text          NOT NULL,
        "counter"       bigint        NOT NULL DEFAULT 0,
        "device_type"   varchar(32)   NOT NULL DEFAULT 'singleDevice',
        "backed_up"     boolean       NOT NULL DEFAULT false,
        "transports"    jsonb         NOT NULL DEFAULT '[]',
        "friendly_name" varchar(128),
        "created_at"    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_passkey_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "uq_passkey_credentials_credential_id" UNIQUE ("credential_id"),
        CONSTRAINT "fk_passkey_credentials_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_passkey_credentials_user" ON "passkey_credentials" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "passkey_credentials"`);
  }
}
