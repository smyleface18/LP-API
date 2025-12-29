import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1766968974234 implements MigrationInterface {
    name = 'Migration1766968974234'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_407836c4787942dcb67b121be57"`);
        await queryRunner.query(`CREATE TYPE "public"."game_difficulty_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`);
        await queryRunner.query(`CREATE TABLE "game" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "difficulty" "public"."game_difficulty_enum" NOT NULL, CONSTRAINT "PK_352a30652cd352f552fef73dec5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_game" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "score" integer NOT NULL, "completedAt" TIMESTAMP NOT NULL, "userId" uuid, "gameId" uuid, CONSTRAINT "PK_4ad0dcdcd6b1d348407ae324fd0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "game_questions_question" ("gameId" uuid NOT NULL, "questionId" uuid NOT NULL, CONSTRAINT "PK_c779b1a9eb7c4196de6fbf0cf39" PRIMARY KEY ("gameId", "questionId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fddc6783cfe03a282274dad5af" ON "game_questions_question" ("gameId") `);
        await queryRunner.query(`CREATE INDEX "IDX_200a49f632034380c384928d3a" ON "game_questions_question" ("questionId") `);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "gameQuestionId"`);
        await queryRunner.query(`CREATE TYPE "public"."user_userrole_enum" AS ENUM('PLAYER', 'ADMIN')`);
        await queryRunner.query(`ALTER TABLE "user" ADD "userRole" "public"."user_userrole_enum" NOT NULL DEFAULT 'PLAYER'`);
        await queryRunner.query(`CREATE TYPE "public"."user_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`);
        await queryRunner.query(`ALTER TABLE "user" ADD "level" "public"."user_level_enum" NOT NULL DEFAULT 'A1'`);
        await queryRunner.query(`ALTER TABLE "user" ADD "user_games_id" uuid`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "score" SET DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_533858e6b1a2c90bc1ef7bf0381" FOREIGN KEY ("user_games_id") REFERENCES "user_game"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_game" ADD CONSTRAINT "FK_1786ddc11e6e542cd0cd1998b8d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_game" ADD CONSTRAINT "FK_efca7c34243bd941b730135e2c0" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_questions_question" ADD CONSTRAINT "FK_fddc6783cfe03a282274dad5aff" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "game_questions_question" ADD CONSTRAINT "FK_200a49f632034380c384928d3a4" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "game_questions_question" DROP CONSTRAINT "FK_200a49f632034380c384928d3a4"`);
        await queryRunner.query(`ALTER TABLE "game_questions_question" DROP CONSTRAINT "FK_fddc6783cfe03a282274dad5aff"`);
        await queryRunner.query(`ALTER TABLE "user_game" DROP CONSTRAINT "FK_efca7c34243bd941b730135e2c0"`);
        await queryRunner.query(`ALTER TABLE "user_game" DROP CONSTRAINT "FK_1786ddc11e6e542cd0cd1998b8d"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_533858e6b1a2c90bc1ef7bf0381"`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "score" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "user_games_id"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "level"`);
        await queryRunner.query(`DROP TYPE "public"."user_level_enum"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "userRole"`);
        await queryRunner.query(`DROP TYPE "public"."user_userrole_enum"`);
        await queryRunner.query(`ALTER TABLE "user" ADD "gameQuestionId" uuid`);
        await queryRunner.query(`DROP INDEX "public"."IDX_200a49f632034380c384928d3a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fddc6783cfe03a282274dad5af"`);
        await queryRunner.query(`DROP TABLE "game_questions_question"`);
        await queryRunner.query(`DROP TABLE "user_game"`);
        await queryRunner.query(`DROP TABLE "game"`);
        await queryRunner.query(`DROP TYPE "public"."game_difficulty_enum"`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_407836c4787942dcb67b121be57" FOREIGN KEY ("gameQuestionId") REFERENCES "game_question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
