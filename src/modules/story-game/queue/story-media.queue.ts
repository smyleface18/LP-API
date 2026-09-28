import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { MediaRequestedEvent, STORY_EVENTS } from '../domain/story-game.events';
import { STORY_MEDIA_QUEUE, STORY_MEDIA_JOB_PRIORITY, storyMediaJobId } from './type';

/**
 * Encola dos tareas por viñeta en `story-media`: `panel-audio` y
 * `panel-image`. Los audios tienen prioridad: salen todos antes que las
 * imágenes, así una imagen lenta nunca demora el audio de otra viñeta. Dentro
 * de cada tipo, en orden: la primera viñeta sale primero, y su audio es el que
 * habilita el REVIEW. Si una tarea se pierde, `media-deadline` termina la
 * historieta igual.
 */
@Injectable()
export class StoryMediaQueue {
  private readonly logger = new Logger(StoryMediaQueue.name);

  constructor(@InjectQueue(STORY_MEDIA_QUEUE) private readonly queue: Queue) {}

  @OnEvent(STORY_EVENTS.mediaRequested, { async: true, promisify: true })
  async enqueue({ gameId, panels }: MediaRequestedEvent): Promise<void> {
    try {
      await this.queue.addBulk(
        (['panel-audio', 'panel-image'] as const).flatMap((name) =>
          panels.map((panel) => ({
            name,
            data: panel,
            opts: {
              // Id fijo: si el evento se repite, BullMQ no duplica la tarea.
              jobId: storyMediaJobId(gameId, name, panel.order),
              priority: STORY_MEDIA_JOB_PRIORITY[name],
              removeOnComplete: true,
              removeOnFail: true,
            },
          })),
        ),
      );
      this.logger.debug(`story ${gameId}: ${panels.length} panels queued for media`);
    } catch (error) {
      // El plazo (`media-deadline`) termina la historieta aunque no se encole nada.
      this.logger.error(`story ${gameId}: could not queue the media: ${(error as Error).message}`);
    }
  }
}
