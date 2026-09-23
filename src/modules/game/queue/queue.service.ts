import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { GameJob } from './type';

export const GAME_SCHEDULE_EVENT = 'game.schedule';

/**
 * Scheduler durable del game loop sobre BullMQ: sobrevive a reinicios y lo
 * procesa una sola instancia. Es solo un "despertador" — la precisión del
 * delay no afecta la partida porque los tiempos que cuentan son los
 * startsAt/endsAt absolutos guardados en el match.
 */
@Injectable()
export class GameTimeoutQueue {
  private readonly logger = new Logger(GameTimeoutQueue.name);

  constructor(
    @InjectQueue('game-question-timeout')
    private readonly queue: Queue,
  ) {}

  // suppressErrors: false para que emitAsync propague el error al que programa.
  @OnEvent(GAME_SCHEDULE_EVENT, { suppressErrors: false })
  async schedule(job: GameJob): Promise<void> {
    const delay = Math.max(0, job.dueAt - Date.now());
    this.logger.debug(`scheduling ${job.kind} room=${job.roomId} seq=${job.seq} in ${delay}ms`);

    await this.queue.add(job.kind, job, {
      // Id determinístico: si el mismo paso se programa dos veces (reintento,
      // dos instancias) BullMQ lo deduplica. BullMQ no admite ':' en ids.
      jobId: `${job.roomId}__${job.seq}__${job.kind}__${job.dueAt}`,
      delay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
