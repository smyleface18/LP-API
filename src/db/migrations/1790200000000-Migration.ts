import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Métricas del jugador para el dashboard: partidas jugadas, partidas ganadas y
 * racha actual de victorias seguidas. Arrancan en 0 para los usuarios
 * existentes (las partidas previas no guardaban quién ganó).
 */
export class Migration1790200000000 implements MigrationInterface {
  name = 'Migration1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "gamesPlayed" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "user" ADD "gamesWon" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "user" ADD "currentStreak" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "currentStreak"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "gamesWon"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "gamesPlayed"`);
  }
}
