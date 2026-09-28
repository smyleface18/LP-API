import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoryGameService } from '../story-game.service';
import { STORY_TIMEOUT_QUEUE, StoryJob } from './type';

@Processor(STORY_TIMEOUT_QUEUE)
export class StoryTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryTimeoutProcessor.name);

  constructor(private readonly storyGameService: StoryGameService) {
    super();
  }

  async process(job: Job<StoryJob>) {
    const { gameId, seq, kind, dueAt } = job.data;
    this.logger.debug(`${kind} game=${gameId} seq=${seq} drift=${Date.now() - dueAt}ms`);

    switch (kind) {
      case 'abandon-idle':
        await this.storyGameService.abandonIdleGame(gameId, seq);
        return;
      case 'close-turn':
        await this.storyGameService.closeTurnByTimeout(gameId, seq, dueAt);
        return;
      case 'media-deadline':
        await this.storyGameService.expireMedia(gameId, dueAt);
        return;
      case 'review-wait':
        await this.storyGameService.endReviewWait(gameId, dueAt);
        return;
      default:
        this.logger.warn(`unknown job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<StoryJob>) {
    this.logger.error(`job failed: ${job.id} - ${job.failedReason}`, job.stacktrace.join('\n'));
  }
}
