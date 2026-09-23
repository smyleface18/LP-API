import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GameService } from '../game.service';
import { GameJob } from './type';

@Processor('game-question-timeout')
export class GameTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GameTimeoutProcessor.name);

  constructor(private readonly gameService: GameService) {
    super();
  }

  async process(job: Job<GameJob>) {
    const { roomId, seq, kind, dueAt } = job.data;
    this.logger.debug(`${kind} room=${roomId} seq=${seq} drift=${Date.now() - dueAt}ms`);

    switch (kind) {
      case 'publish-question':
        await this.gameService.publishQuestion(roomId, seq, dueAt);
        return;
      case 'close-question':
        await this.gameService.closeQuestion(roomId, seq);
        return;
      default:
        this.logger.warn(`unknown job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GameJob>) {
    this.logger.error(`job failed: ${job.id} - ${job.failedReason}`, job.stacktrace.join('\n'));
  }
}
