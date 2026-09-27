import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import {
  STORY_CANCEL_EVENT,
  STORY_SCHEDULE_EVENT,
  STORY_TIMEOUT_QUEUE,
  StoryJob,
  storyJobId,
} from './type';

/**
 * Scheduler durable del modo Historieta sobre BullMQ (como GameTimeoutQueue):
 * sobrevive a reinicios y cada tarea la procesa una sola instancia. Es solo un
 * "despertador": la validez de cada tarea la decide el servicio con `seq`.
 */
@Injectable()
export class StoryTimeoutQueue {
  private readonly logger = new Logger(StoryTimeoutQueue.name);

  constructor(@InjectQueue(STORY_TIMEOUT_QUEUE) private readonly queue: Queue) {}

  // suppressErrors: false para que emitAsync propague el error al que programa.
  @OnEvent(STORY_SCHEDULE_EVENT, { suppressErrors: false })
  async schedule(job: StoryJob): Promise<void> {
    const delay = Math.max(0, job.dueAt - Date.now());
    this.logger.debug(`scheduling ${job.kind} game=${job.gameId} seq=${job.seq} in ${delay}ms`);

    await this.queue.add(job.kind, job, {
      jobId: storyJobId(job),
      delay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Limpieza de una tarea obsoleta. Si falla no pasa nada: se descarta sola al correr. */
  @OnEvent(STORY_CANCEL_EVENT)
  async cancel(job: StoryJob): Promise<void> {
    try {
      await this.queue.remove(storyJobId(job));
    } catch (error) {
      this.logger.warn(`could not remove ${storyJobId(job)}: ${(error as Error).message}`);
    }
  }
}
