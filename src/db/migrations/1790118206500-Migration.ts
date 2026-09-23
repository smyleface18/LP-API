import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790118206500 implements MigrationInterface {
  name = 'Migration1790118206500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "CHK_c36638bdab0837246e4a67f983"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2"`,
    );

    // "text" se agrega y se backfillea desde el JSON viejo ANTES de dropear "content",
    // para no perder el texto de las preguntas/opciones existentes.
    await queryRunner.query(`ALTER TABLE "question_option" ADD "text" text`);
    await queryRunner.query(`UPDATE "question_option" SET "text" = "content"->>'value'`);
    await queryRunner.query(`ALTER TABLE "question_option" DROP COLUMN "content"`);

    await queryRunner.query(`ALTER TABLE "question" ADD "text" text`);
    await queryRunner.query(`UPDATE "question" SET "text" = "content"->>'value'`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "content"`);

    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "CHK_69063a571b7d8950136ae7f3c5" CHECK (("contentType" = 'TEXT' AND "media_id" IS NULL AND "text" IS NOT NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL AND "text" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "CHK_55410ad3b0bbed036cd6ffd02d" CHECK (("contentType" = 'TEXT' AND "media_id" IS NULL AND "text" IS NOT NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL AND "text" IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "CHK_55410ad3b0bbed036cd6ffd02d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "CHK_69063a571b7d8950136ae7f3c5"`,
    );

    // Reconstruye "content" como {type, value}; "meta" (S3Object embebido) no se puede
    // recuperar porque dejó de guardarse desde que se agregó esta migración.
    await queryRunner.query(`ALTER TABLE "question" ADD "content" json`);
    await queryRunner.query(
      `UPDATE "question" SET "content" = json_build_object('type', "contentType", 'value', "text")`,
    );
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "content" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "text"`);

    await queryRunner.query(`ALTER TABLE "question_option" ADD "content" json`);
    await queryRunner.query(
      `UPDATE "question_option" SET "content" = json_build_object('type', "contentType", 'value', "text")`,
    );
    await queryRunner.query(`ALTER TABLE "question_option" ALTER COLUMN "content" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question_option" DROP COLUMN "text"`);

    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2" CHECK (("contentType" = 'TEXT' AND media_id IS NULL) OR ("contentType" != 'TEXT' AND media_id IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "CHK_c36638bdab0837246e4a67f983" CHECK (("contentType" = 'TEXT' AND media_id IS NULL) OR ("contentType" != 'TEXT' AND media_id IS NOT NULL))`,
    );
  }
}
