import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoryMediaService } from '@/modules/story-media/story-media.service';
import { StoryGameService } from '../story-game.service';
import { PanelMediaRequestEvent } from '../domain/story-game.events';
import { STORY_MEDIA_CONCURRENCY, STORY_MEDIA_QUEUE } from './type';

/**
 * Genera la media de una viñeta (StoryMediaService nunca lanza) y le pasa el
 * resultado al servicio, que decide si la partida avanza a REVIEW o FINISHED.
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

  async process(job: Job<PanelMediaRequestEvent>) {
    const request = job.data;
    const result = await this.media.generatePanel(request);
    await this.storyGameService.onPanelMedia(request.gameId, request.order, result);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PanelMediaRequestEvent>) {
    this.logger.error(`media job failed: ${job.id} - ${job.failedReason}`);
  }
}
