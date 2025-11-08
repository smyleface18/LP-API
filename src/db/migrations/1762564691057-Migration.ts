import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1762564691057 implements MigrationInterface {
  name = 'Migration1762564691057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."category_question_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."category_question_type_enum" AS ENUM('LISTENING', 'GRAMMAR', 'READING', 'VOCABULARY', 'WRITING', 'SPEAKING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "category_question" ("id" uuid NOT NULL, "active" boolean DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "level" "public"."category_question_level_enum" NOT NULL, "descriptionCategory" character varying NOT NULL, "type" "public"."category_question_type_enum" NOT NULL, CONSTRAINT "PK_3053314e2b73e92cabdc014a09c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "question" ("id" uuid NOT NULL, "active" boolean DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "question" character varying NOT NULL, "options" text array NOT NULL, "correctAnswer" character varying NOT NULL, "category_id" uuid NOT NULL, CONSTRAINT "PK_21e5786aa0ea704ae185a79b2d5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_5fd605f755be75e9ea3ee3fdc18" FOREIGN KEY ("category_id") REFERENCES "category_question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "FK_5fd605f755be75e9ea3ee3fdc18"`,
    );
    await queryRunner.query(`DROP TABLE "question"`);
    await queryRunner.query(`DROP TABLE "category_question"`);
    await queryRunner.query(`DROP TYPE "public"."category_question_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."category_question_level_enum"`);
  }
}
