import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historial de moderación de historietas (quitar y restaurar). Las que ya
 * estaban quitadas reciben su fila REMOVED con los datos que tenía `story`.
 */

export class Migration1790628997226 implements MigrationInterface {
  name = 'Migration1790628997226';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."story_moderation_log_action_enum" AS ENUM('REMOVED', 'RESTORED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."story_moderation_log_reason_enum" AS ENUM('INAPPROPRIATE_CONTENT', 'OFFENSIVE_LANGUAGE', 'PERSONAL_DATA', 'SPAM', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TABLE "story_moderation_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "story_id" uuid NOT NULL, "action" "public"."story_moderation_log_action_enum" NOT NULL, "admin_id" uuid, "reason" "public"."story_moderation_log_reason_enum", "note" character varying(500), CONSTRAINT "PK_e92ebfa47a02432910bf0f0ba2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_712a47bc616958fb3929ab36ad" ON "story_moderation_log" ("story_id", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "story_moderation_log" ADD CONSTRAINT "FK_58a83f0c6a06a5218ef4839c373" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_moderation_log" ADD CONSTRAINT "FK_65fa377096e03dbf6864a0bf04a" FOREIGN KEY ("admin_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `INSERT INTO "story_moderation_log" ("story_id", "action", "admin_id", "reason", "note", "createdAt")
             SELECT "id", 'REMOVED', "removed_by_id", "removalReason"::text::"public"."story_moderation_log_reason_enum", "removalNote", COALESCE("removedAt", now())
             FROM "story" WHERE "visibility" = 'REMOVED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "story_moderation_log" DROP CONSTRAINT "FK_65fa377096e03dbf6864a0bf04a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_moderation_log" DROP CONSTRAINT "FK_58a83f0c6a06a5218ef4839c373"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_712a47bc616958fb3929ab36ad"`);
    await queryRunner.query(`DROP TABLE "story_moderation_log"`);
    await queryRunner.query(`DROP TYPE "public"."story_moderation_log_reason_enum"`);
    await queryRunner.query(`DROP TYPE "public"."story_moderation_log_action_enum"`);
  }
}
