import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Game, GameSession, PlayerAnswer, User } from '@/db/entities';
import { Match } from './domain/match.entity';
import { determineWinners } from './domain/match-outcome';

/**
 * Guarda en Postgres el resultado de una partida terminada: un Game con sus
 * preguntas, una GameSession por jugador (score y posición), sus
 * PlayerAnswer, y actualiza las métricas del User: score total, partidas
 * jugadas/ganadas y racha actual.
 * Todo en una transacción para no dejar resultados a medias.
 */
@Injectable()
export class MatchResultsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Devuelve userId -> score total actualizado. */
  async persist(match: Match): Promise<Map<string, number>> {
    const players = match.getPlayersWithInfo();
    const answers = match.getAnswers();
    const positions = this.rankPositions(players.map((p) => p.matchScore));
    const winners = determineWinners(match);

    return this.dataSource.transaction(async (manager) => {
      const game = await manager.save(
        manager.create(Game, {
          difficulty: match.getDifficulty(),
          questions: match.getQuestions().map((q) => ({ id: q.id })),
        }),
      );

      const totals = new Map<string, number>();

      for (const [index, player] of players.entries()) {
        const session = await manager.save(
          manager.create(GameSession, {
            userId: player.userId,
            gameId: game.id,
            score: player.matchScore,
            position: positions[index],
          }),
        );

        const playerAnswers = answers
          .filter((a) => a.userId === player.userId)
          .map((a) =>
            manager.create(PlayerAnswer, {
              gameSessionId: session.id,
              questionId: a.questionId,
              selectedOptionId: a.optionId,
              isCorrect: a.isCorrect,
              timeTaken: a.timeTaken,
            }),
          );
        if (playerAnswers.length > 0) await manager.save(playerAnswers);

        // Todo en un UPDATE atómico sobre los valores actuales de la fila (no
        // leer-modificar-escribir): dos partidas del mismo usuario que terminan
        // a la vez no se pisan. Los valores son enteros calculados por nosotros.
        const won = winners.has(player.userId);
        const points = Math.trunc(player.matchScore);
        await manager
          .createQueryBuilder()
          .update(User)
          .set({
            score: () => `"score" + ${points}`,
            gamesPlayed: () => `"gamesPlayed" + 1`,
            gamesWon: () => `"gamesWon" + ${won ? 1 : 0}`,
            currentStreak: () => (won ? `"currentStreak" + 1` : '0'),
          })
          .where('id = :id', { id: player.userId })
          .execute();
        const user = await manager.findOne(User, {
          where: { id: player.userId },
          select: { id: true, score: true },
        });
        totals.set(player.userId, user?.score ?? player.totalScore + player.matchScore);
      }

      return totals;
    });
  }

  /** Posición 1-based por score descendente; empates comparten posición. */
  private rankPositions(scores: number[]): number[] {
    return scores.map((score) => scores.filter((other) => other > score).length + 1);
  }
}
