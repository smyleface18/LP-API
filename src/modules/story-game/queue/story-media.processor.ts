import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoryMediaService } from '@/modules/story-media/story-media.service';
import { StoryGameService } from '../story-game.service';
import { PanelMediaRequestEvent } from '../domain/story-game.events';
import { STORY_MEDIA_CONCURRENCY, STORY_MEDIA_QUEUE, StoryMediaJobName } from './type';

/**
 * Tareas de `story-media` (StoryMediaService nunca lanza):
 * - `panel-audio`: narra la viñeta y le pasa el resultado a `onPanelAudio`.
 * - `panel-image`: si la imagen sigue pendiente (no venció el plazo ni hubo
 *   un 429 en la historieta), la dibuja y le pasa el resultado a `onPanelImage`.
 */
@Processor(STORY_MEDIA_QUEUE, { concurrency: STORY_MEDIA_CONCURRENCY })
export class StoryMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryMediaProcessor.name);

  constructor(
    private readonly media: StoryMediaService,
    private readonly storyGameService: StoryGameService,
  ) {
    super();
  }

  async process(job: Job<PanelMediaRequestEvent, void, StoryMediaJobName>) {
    const request = job.data;
    const { gameId, order } = request;

    if (job.name === 'panel-image') {
      if (!(await this.storyGameService.isImagePending(gameId, order))) return;
      const image = await this.media.generateImage(request);
      await this.storyGameService.onPanelImage(gameId, order, image);
      return;
    }

    const audio = await this.media.generateAudio(request);
    await this.storyGameService.onPanelAudio(gameId, order, audio);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PanelMediaRequestEvent>) {
    this.logger.error(`media job failed: ${job.id} - ${job.failedReason}`);
  }
}
