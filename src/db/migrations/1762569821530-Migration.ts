import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1762569821530 implements MigrationInterface {
    name = 'Migration1762569821530'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "question"`);
        await queryRunner.query(`ALTER TABLE "question" ADD "questionText" character varying`);
        await queryRunner.query(`ALTER TABLE "question" ADD "questionImage" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "questionImage"`);
        await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "questionText"`);
        await queryRunner.query(`ALTER TABLE "question" ADD "question" character varying NOT NULL`);
    }

}
