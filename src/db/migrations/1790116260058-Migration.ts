import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790116260058 implements MigrationInterface {
  name = 'Migration1790116260058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" RENAME COLUMN "avatar" TO "avatar_id"`);
    await queryRunner.query(
      `CREATE TYPE "public"."media_asset_contenttype_enum" AS ENUM('TEXT', 'IMAGE', 'AUDIO', 'VIDEO')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."media_asset_status_enum" AS ENUM('PENDING', 'CONFIRMED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "media_asset" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "key" character varying NOT NULL, "bucketName" character varying NOT NULL, "contentType" "public"."media_asset_contenttype_enum" NOT NULL, "mimeType" character varying, "displayName" character varying, "size" integer, "url" character varying, "status" "public"."media_asset_status_enum" NOT NULL DEFAULT 'PENDING', "uploaded_by_user_id" uuid, CONSTRAINT "PK_facd363e2bf84400ac44913a2f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "question_option" ADD "media_id" uuid`);
    await queryRunner.query(`ALTER TABLE "question" ADD "media_id" uuid`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "avatar_id"`);
    await queryRunner.query(`ALTER TABLE "user" ADD "avatar_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_b777e56620c3f1ac0308514fc4c" FOREIGN KEY ("avatar_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_asset" ADD CONSTRAINT "FK_5395c09f1a3173b3970aca98ae3" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" ADD CONSTRAINT "FK_20a9398ccac7390339110bb74c5" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_75e265637a9073a12d10387e4b9" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question" DROP CONSTRAINT "FK_75e265637a9073a12d10387e4b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_option" DROP CONSTRAINT "FK_20a9398ccac7390339110bb74c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_asset" DROP CONSTRAINT "FK_5395c09f1a3173b3970aca98ae3"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_b777e56620c3f1ac0308514fc4c"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "avatar_id"`);
    await queryRunner.query(`ALTER TABLE "user" ADD "avatar_id" json`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "media_id"`);
    await queryRunner.query(`ALTER TABLE "question_option" DROP COLUMN "media_id"`);
    await queryRunner.query(`DROP TABLE "media_asset"`);
    await queryRunner.query(`DROP TYPE "public"."media_asset_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."media_asset_contenttype_enum"`);
    await queryRunner.query(`ALTER TABLE "user" RENAME COLUMN "avatar_id" TO "avatar"`);
  }
}
