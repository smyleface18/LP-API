import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1777350670999 implements MigrationInterface {
  name = 'Migration1777350670999';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."category_question_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."category_question_type_enum" AS ENUM('LISTENING', 'GRAMMAR', 'READING', 'VOCABULARY', 'WRITING', 'SPEAKING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "category_question" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "level" "public"."category_question_level_enum" NOT NULL, "descriptionCategory" character varying NOT NULL, "type" "public"."category_question_type_enum" NOT NULL, CONSTRAINT "PK_3053314e2b73e92cabdc014a09c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "question_option" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "content" json NOT NULL, "isCorrect" boolean NOT NULL DEFAULT false, "question_id" uuid NOT NULL, CONSTRAINT "PK_64f8e42188891f2b0610017c8f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "question" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "content" json NOT NULL, "category_id" uuid NOT NULL, "timeLimit" integer NOT NULL DEFAULT '5000', CONSTRAINT "PK_21e5786aa0ea704ae185a79b2d5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."user_userrole_enum" AS ENUM('PLAYER', 'ADMIN')`);
    await queryRunner.query(
      `CREATE TYPE "public"."user_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "username" character varying NOT NULL, "email" character varying NOT NULL, "score" integer NOT NULL DEFAULT '0', "userRole" "public"."user_userrole_enum" NOT NULL DEFAULT 'PLAYER', "level" "public"."user_level_enum" NOT NULL DEFAULT 'A1', "avatar" json, CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "player_answer" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "game_session_id" uuid NOT NULL, "question_id" uuid NOT NULL, "selected_option_id" uuid NOT NULL, "isCorrect" boolean NOT NULL, "timeTaken" integer NOT NULL, CONSTRAINT "PK_ef764290b852c90cb6ab60f20e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_session" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "user_id" uuid NOT NULL, "game_id" uuid NOT NULL, "score" integer NOT NULL, "position" integer, CONSTRAINT "PK_58b630233711ccafbb0b2a904fc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_difficulty_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TABLE "game" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "difficulty" "public"."game_difficulty_enum" NOT NULL, CONSTRAINT "PK_352a30652cd352f552fef73dec5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_questions_question" ("gameId" uuid NOT NULL, "questionId" uuid NOT NULL, CONSTRAINT "PK_c779b1a9eb7c4196de6fbf0cf39" PRIMARY KEY ("gameId", "questionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fddc6783cfe03a282274dad5af" ON "game_questions_question" ("gameId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_200a49f632034380c384928d3a" ON "game_questions_question" ("questionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "FK_747190c37a39feced5efcbb303f" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_5fd605f755be75e9ea3ee3fdc18" FOREIGN KEY ("category_id") REFERENCES "category_question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" ADD CONSTRAINT "FK_c1e8bedcf1fa57659f319df5739" FOREIGN KEY ("game_session_id") REFERENCES "game_session"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" ADD CONSTRAINT "FK_dd18c51c261c8a6695c129dc9e9" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" ADD CONSTRAINT "FK_e401ab8700e2191e9d1d89a461a" FOREIGN KEY ("selected_option_id") REFERENCES "question_option"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_session" ADD CONSTRAINT "FK_e771dcf69ac8e0a2cfe4da708f2" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_session" ADD CONSTRAINT "FK_f922e0c891b6dc5b061dea2807b" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_questions_question" ADD CONSTRAINT "FK_fddc6783cfe03a282274dad5aff" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_questions_question" ADD CONSTRAINT "FK_200a49f632034380c384928d3a4" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_questions_question" DROP CONSTRAINT "FK_200a49f632034380c384928d3a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_questions_question" DROP CONSTRAINT "FK_fddc6783cfe03a282274dad5aff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_session" DROP CONSTRAINT "FK_f922e0c891b6dc5b061dea2807b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_session" DROP CONSTRAINT "FK_e771dcf69ac8e0a2cfe4da708f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" DROP CONSTRAINT "FK_e401ab8700e2191e9d1d89a461a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" DROP CONSTRAINT "FK_dd18c51c261c8a6695c129dc9e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_answer" DROP CONSTRAINT "FK_c1e8bedcf1fa57659f319df5739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "FK_5fd605f755be75e9ea3ee3fdc18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "FK_747190c37a39feced5efcbb303f"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_200a49f632034380c384928d3a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fddc6783cfe03a282274dad5af"`);
    await queryRunner.query(`DROP TABLE "game_questions_question"`);
    await queryRunner.query(`DROP TABLE "game"`);
    await queryRunner.query(`DROP TYPE "public"."game_difficulty_enum"`);
    await queryRunner.query(`DROP TABLE "game_session"`);
    await queryRunner.query(`DROP TABLE "player_answer"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TYPE "public"."user_level_enum"`);
    await queryRunner.query(`DROP TYPE "public"."user_userrole_enum"`);
    await queryRunner.query(`DROP TABLE "question"`);
    await queryRunner.query(`DROP TABLE "question_option"`);
    await queryRunner.query(`DROP TABLE "category_question"`);
    await queryRunner.query(`DROP TYPE "public"."category_question_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."category_question_level_enum"`);
  }
}
