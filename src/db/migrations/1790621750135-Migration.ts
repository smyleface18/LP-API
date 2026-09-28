import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Título de las historietas del modo Historieta (lo pone la IA al terminar).
 * Nullable: las historietas ya guardadas no tienen, y la IA puede no dar uno.
 */
export class Migration1790621750135 implements MigrationInterface {
  name = 'Migration1790621750135';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "story" ADD "title" character varying(80)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "story" DROP COLUMN "title"`);
  }
}
