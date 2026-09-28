import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { MediaRequestedEvent, STORY_EVENTS } from '../domain/story-game.events';
import { STORY_MEDIA_QUEUE, storyMediaJobId } from './type';

/**
 * Encola una tarea por viñeta en `story-media` (Fase 4b). En orden: la
 * primera viñeta sale primero, y es la que habilita el REVIEW. Si una tarea se
 * pierde, `media-deadline` termina la historieta igual.
 */
@Injectable()
export class StoryMediaQueue {
  private readonly logger = new Logger(StoryMediaQueue.name);

  constructor(@InjectQueue(STORY_MEDIA_QUEUE) private readonly queue: Queue) {}

  @OnEvent(STORY_EVENTS.mediaRequested, { async: true, promisify: true })
  async enqueue({ gameId, panels }: MediaRequestedEvent): Promise<void> {
    try {
      await this.queue.addBulk(
        panels.map((panel) => ({
          name: 'panel-media',
          data: panel,
          opts: {
            // Id fijo: si el evento se repite, BullMQ no duplica la tarea.
            jobId: storyMediaJobId(gameId, panel.order),
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
      this.logger.debug(`story ${gameId}: ${panels.length} panels queued for media`);
    } catch (error) {
      // El plazo (`media-deadline`) termina la historieta aunque no se encole nada.
      this.logger.error(`story ${gameId}: could not queue the media: ${(error as Error).message}`);
    }
  }
}
