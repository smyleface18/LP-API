import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1777932325157 implements MigrationInterface {
  name = 'Migration1777932325157';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" ADD "moreInfo" text`);
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "timeLimit" SET DEFAULT '5'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "timeLimit" SET DEFAULT '5000'`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "moreInfo"`);
  }
}
