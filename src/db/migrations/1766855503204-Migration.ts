import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1766855503204 implements MigrationInterface {
  name = 'Migration1766855503204';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "username" character varying NOT NULL, "email" character varying NOT NULL, "score" integer NOT NULL, "avatar" json, "gameQuestionId" uuid, CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_question" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "question" character varying NOT NULL, "difficulty" character varying NOT NULL, "category" character varying, CONSTRAINT "PK_08867ba249fa9d179d5449d27d3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "question_option" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "text" character varying, "media" json, "isCorrect" boolean NOT NULL DEFAULT false, "question_id" uuid NOT NULL, CONSTRAINT "PK_64f8e42188891f2b0610017c8f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "options"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "correctAnswer"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "questionImage"`);
    await queryRunner.query(
      `ALTER TABLE "question" ADD "timeLimit" integer NOT NULL DEFAULT '5000'`,
    );
    await queryRunner.query(`ALTER TABLE "question" ADD "media" json`);
    await queryRunner.query(`ALTER TABLE "category_question" ALTER COLUMN "active" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "active" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "questionText" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_407836c4787942dcb67b121be57" FOREIGN KEY ("gameQuestionId") REFERENCES "game_question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "FK_747190c37a39feced5efcbb303f" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "FK_747190c37a39feced5efcbb303f"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_407836c4787942dcb67b121be57"`);
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "questionText" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "active" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "category_question" ALTER COLUMN "active" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "media"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "timeLimit"`);
    await queryRunner.query(`ALTER TABLE "question" ADD "questionImage" character varying`);
    await queryRunner.query(
      `ALTER TABLE "question" ADD "correctAnswer" character varying NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "question" ADD "options" text array NOT NULL`);
    await queryRunner.query(`DROP TABLE "question_option"`);
    await queryRunner.query(`DROP TABLE "game_question"`);
    await queryRunner.query(`DROP TABLE "user"`);
  }
}
