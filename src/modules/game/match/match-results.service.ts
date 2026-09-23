import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Game, GameSession, PlayerAnswer, User } from '@/db/entities';
import { Match } from './domain/match.entity';

/**
 * Guarda en Postgres el resultado de una partida terminada: un Game con sus
 * preguntas, una GameSession por jugador (score y posición), sus
 * PlayerAnswer, y suma el score de la partida al score total del User.
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

        if (player.matchScore > 0) {
          await manager.increment(User, { id: player.userId }, 'score', player.matchScore);
        }
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
