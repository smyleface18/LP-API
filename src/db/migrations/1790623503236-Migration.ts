import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790623503236 implements MigrationInterface {
  name = 'Migration1790623503236';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."story_visibility_enum" AS ENUM('PUBLISHED', 'REMOVED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "story" ADD "visibility" "public"."story_visibility_enum" NOT NULL DEFAULT 'PUBLISHED'`,
    );
    await queryRunner.query(`ALTER TABLE "story" ADD "removedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "story" ADD "removed_by_id" uuid`);
    await queryRunner.query(
      `CREATE TYPE "public"."story_removalreason_enum" AS ENUM('INAPPROPRIATE_CONTENT', 'OFFENSIVE_LANGUAGE', 'PERSONAL_DATA', 'SPAM', 'OTHER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "story" ADD "removalReason" "public"."story_removalreason_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "story" ADD "removalNote" character varying(500)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_abe95f6798bad4ff8e4708150d" ON "story" ("visibility", "finishedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "story" ADD CONSTRAINT "FK_3b10b7c6031727bb957c643ec07" FOREIGN KEY ("removed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "story" DROP CONSTRAINT "FK_3b10b7c6031727bb957c643ec07"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_abe95f6798bad4ff8e4708150d"`);
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "removalNote"`);
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "removalReason"`);
    await queryRunner.query(`DROP TYPE "public"."story_removalreason_enum"`);
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "removed_by_id"`);
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "removedAt"`);
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "visibility"`);
    await queryRunner.query(`DROP TYPE "public"."story_visibility_enum"`);
  }
}
