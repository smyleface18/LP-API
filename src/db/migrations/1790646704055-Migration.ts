import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1790646704055 implements MigrationInterface {
    name = 'Migration1790646704055'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "story_like" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "story_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_60d762da5ea61294cc33fc02944" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_44b8b4fb41df222121b1644c67" ON "story_like" ("story_id", "user_id") `);
        await queryRunner.query(`ALTER TABLE "story_like" ADD CONSTRAINT "FK_4c2ca6c0411279cb56db439998f" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "story_like" ADD CONSTRAINT "FK_8cf5497a2671958cc1a7c7cb2a9" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "story_like" DROP CONSTRAINT "FK_8cf5497a2671958cc1a7c7cb2a9"`);
        await queryRunner.query(`ALTER TABLE "story_like" DROP CONSTRAINT "FK_4c2ca6c0411279cb56db439998f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_44b8b4fb41df222121b1644c67"`);
        await queryRunner.query(`DROP TABLE "story_like"`);
    }

}
