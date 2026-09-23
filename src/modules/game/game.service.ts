import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchService } from './match/match.service';
import { GAME_SCHEDULE_EVENT } from './queue/queue.service';
import { GameJob } from './queue/type';
import { ANSWER_GRACE_MS, QUESTION_LEAD_MS, START_COUNTDOWN_MS } from './game-timing';

/**
 * Game loop con línea de tiempo absoluta (server-authoritative):
 *
 *   start ──countdown──▶ publish(q1) ──lead──▶ startsAt ──timeLimit──▶ endsAt
 *     ──gracia──▶ close(q1) ──reveal──▶ publish(q2) ... ──▶ finish
 *
 * Cada pregunta viaja con startsAt/endsAt en hora del servidor; los clientes
 * sincronizan su reloj (timeSync) y muestran/cuentan contra esos instantes,
 * así todos ven lo mismo al mismo tiempo sin importar la latencia. El servidor
 * valida respuestas contra la misma ventana. BullMQ solo despierta al servidor
 * para cada transición; cada paso es idempotente (seq) y se ancla a la hora
 * planeada, por lo que atrasos del scheduler no se acumulan.
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly matchService: MatchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Arranca la partida. Devuelve cuándo se mostrará la primera pregunta (hora del servidor). */
  async start(roomId: string, userId: string): Promise<{ firstQuestionAt: number }> {
    const { seq } = await this.matchService.startMatch(roomId, userId);
    const publishAt = Date.now() + START_COUNTDOWN_MS;

    await this.schedule({ roomId, seq, kind: 'publish-question', dueAt: publishAt });

    return { firstQuestionAt: publishAt + QUESTION_LEAD_MS };
  }

  async publishQuestion(roomId: string, seq: number, plannedAt: number) {
    const result = await this.matchService.publishNextQuestion(roomId, seq, plannedAt, Date.now());

    if (result.kind === 'stale') return;
    if (result.kind === 'finished') {
      await this.finishMatch(roomId);
      return;
    }

    this.eventEmitter.emit('game.next-question', {
      roomId,
      question: result.question,
      questionNumber: result.questionNumber,
      totalQuestions: result.totalQuestions,
      timeLimit: result.question.timeLimit,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
    });

    await this.schedule({
      roomId,
      seq: result.seq,
      kind: 'close-question',
      dueAt: result.endsAt + ANSWER_GRACE_MS,
    });
  }

  async closeQuestion(roomId: string, seq: number) {
    const result = await this.matchService.closeQuestion(roomId, seq, Date.now());

    if (result.kind === 'stale') return;
    if (result.kind === 'early') {
      await this.schedule({ roomId, seq, kind: 'close-question', dueAt: result.dueAt });
      return;
    }

    this.eventEmitter.emit('game.question-ended', {
      roomId,
      questionId: result.questionId,
      nextQuestionAt: result.hasNext ? result.nextPlannedAt + QUESTION_LEAD_MS : null,
    });

    if (!result.hasNext) {
      await this.finishMatch(roomId);
      return;
    }

    await this.schedule({
      roomId,
      seq: result.seq,
      kind: 'publish-question',
      dueAt: result.nextPlannedAt,
    });
  }

  async finishMatch(roomId: string) {
    this.logger.log(`finishing match ${roomId}`);
    const results = await this.matchService.finishMatch(roomId);
    this.eventEmitter.emit('game.finished', {
      roomId,
      results,
    });
  }

  // emitAsync espera al listener: si no se puede programar el paso, el error
  // sube (y el job/handler falla) en vez de dejar la partida colgada en silencio.
  private async schedule(job: GameJob) {
    await this.eventEmitter.emitAsync(GAME_SCHEDULE_EVENT, job);
  }
}
