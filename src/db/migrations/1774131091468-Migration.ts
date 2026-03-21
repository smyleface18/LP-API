import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1774131091468 implements MigrationInterface {
  name = 'Migration1774131091468';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "timeLimit" SET DEFAULT '5000'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" ALTER COLUMN "timeLimit" SET DEFAULT '15'`);
  }
}
