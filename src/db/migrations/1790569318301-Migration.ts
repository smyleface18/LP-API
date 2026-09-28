import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historial del modo Historieta (Fase 4c): historietas terminadas, sus
 * viñetas (texto, correcciones, puntaje, reacciones y keys de S3 de la media)
 * y sus participantes con el ranking.
 */
export class Migration1790569318301 implements MigrationInterface {
  name = 'Migration1790569318301';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "story_panel" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "story_id" uuid NOT NULL, "order" integer NOT NULL, "author_id" uuid, "authorName" character varying NOT NULL, "originalText" text NOT NULL, "finalText" text NOT NULL, "scene" text NOT NULL, "characterIds" jsonb NOT NULL DEFAULT '[]', "corrections" jsonb NOT NULL DEFAULT '[]', "score" jsonb NOT NULL, "reactions" jsonb NOT NULL DEFAULT '{}', "mediaStatus" character varying NOT NULL DEFAULT 'none', "audioKey" character varying, "imageKey" character varying, "speechMarks" jsonb, CONSTRAINT "UQ_b9e11e17a046874426e797ceb88" UNIQUE ("story_id", "order"), CONSTRAINT "PK_c18bffc277483a15b76c4272674" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "story_participant" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "story_id" uuid NOT NULL, "user_id" uuid NOT NULL, "username" character varying NOT NULL, "position" integer NOT NULL, "panelsWritten" integer NOT NULL, "totalScore" integer NOT NULL, "averageScore" real NOT NULL, "left" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_03dec0d98c1cee8078d86b4c164" UNIQUE ("story_id", "user_id"), CONSTRAINT "PK_4151179c4828eaf161d6b03bee4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_560e26dd7295d6bb3696832345" ON "story_participant" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."story_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TABLE "story" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "gameId" character varying NOT NULL, "level" "public"."story_level_enum" NOT NULL, "language" character varying NOT NULL, "panelsCount" integer NOT NULL, "characters" jsonb NOT NULL DEFAULT '[]', "finishedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_bce4f43a9d6af657307f3051dee" UNIQUE ("gameId"), CONSTRAINT "PK_28fce6873d61e2cace70a0f3361" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_panel" ADD CONSTRAINT "FK_dbe3cb45b0815595840d73e9884" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_panel" ADD CONSTRAINT "FK_5dc0ae81e4cccc99a00a55506b9" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_participant" ADD CONSTRAINT "FK_070d58c691b83f75a8e70fc6d45" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_participant" ADD CONSTRAINT "FK_560e26dd7295d6bb36968323452" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "story_participant" DROP CONSTRAINT "FK_560e26dd7295d6bb36968323452"`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_participant" DROP CONSTRAINT "FK_070d58c691b83f75a8e70fc6d45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_panel" DROP CONSTRAINT "FK_5dc0ae81e4cccc99a00a55506b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "story_panel" DROP CONSTRAINT "FK_dbe3cb45b0815595840d73e9884"`,
    );
    await queryRunner.query(`DROP TABLE "story"`);
    await queryRunner.query(`DROP TYPE "public"."story_level_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_560e26dd7295d6bb3696832345"`);
    await queryRunner.query(`DROP TABLE "story_participant"`);
    await queryRunner.query(`DROP TABLE "story_panel"`);
  }
}
