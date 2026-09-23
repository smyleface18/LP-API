import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790127284577 implements MigrationInterface {
  name = 'Migration1790127284577';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "CHK_55410ad3b0bbed036cd6ffd02d"`,
    );
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "text" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2" CHECK (("contentType" = 'TEXT' AND "media_id" IS NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "CHK_5e00407541ecca3f0f165bdcf2"`,
    );
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "text" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "CHK_55410ad3b0bbed036cd6ffd02d" CHECK (((("contentType" = 'TEXT'::question_contenttype_enum) AND (media_id IS NULL) AND (text IS NOT NULL)) OR (("contentType" <> 'TEXT'::question_contenttype_enum) AND (media_id IS NOT NULL) AND (text IS NULL))))`,
    );
  }
}
