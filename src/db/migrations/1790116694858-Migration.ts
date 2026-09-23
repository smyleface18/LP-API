import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790116694858 implements MigrationInterface {
  name = 'Migration1790116694858';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."question_option_contenttype_enum" AS ENUM('TEXT', 'IMAGE', 'AUDIO', 'VIDEO')`,
    );
    // DEFAULT 'TEXT' es transitorio: backfillea las filas existentes (todas TEXT hoy) y se elimina abajo
    // para que la columna quede obligatoria de verdad (sin default) hacia adelante.
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD "contentType" "public"."question_option_contenttype_enum" NOT NULL DEFAULT 'TEXT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" ALTER COLUMN "contentType" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."question_contenttype_enum" AS ENUM('TEXT', 'IMAGE', 'AUDIO', 'VIDEO')`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD "contentType" "public"."question_contenttype_enum" NOT NULL DEFAULT 'TEXT'`,
    );
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "contentType" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "CHK_c36638bdab0837246e4a67f983" CHECK (("contentType" = 'TEXT' AND "media_id" IS NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2" CHECK (("contentType" = 'TEXT' AND "media_id" IS NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "CHK_c36638bdab0837246e4a67f983"`,
    );
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "contentType"`);
    await queryRunner.query(`DROP TYPE "public"."question_contenttype_enum"`);
    await queryRunner.query(`ALTER TABLE "question_option" DROP COLUMN "contentType"`);
    await queryRunner.query(`DROP TYPE "public"."question_option_contenttype_enum"`);
  }
}
