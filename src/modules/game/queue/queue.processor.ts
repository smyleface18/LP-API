import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GameService } from '../game.service';
import { GameQueueJobPayload } from './type';

@Processor('game-question-timeout')
export class GameTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GameTimeoutProcessor.name);
  constructor(private readonly gameService: GameService) {
    super();
  }

  async process(job: Job<GameQueueJobPayload, any, string>) {
    this.logger.debug(`processing job ${job.name}`);
    const roomId = job.data.roomId;

    if (job.name.startsWith('start-question-roomId-')) {
      await this.gameService.startQuestion(roomId);
      return;
    }

    if (job.name.startsWith('end-question-roomId-')) {
      await this.gameService.handleQuestionTimeout(roomId);
      return;
    }

    this.logger.warn(`unknown job name: ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GameQueueJobPayload, any, string>) {
    this.logger.debug(`job completed: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GameQueueJobPayload, any, string>) {
    this.logger.error(`job failed: ${job.id} - ${job.failedReason}`, job.stacktrace.join('\n'));
  }
}
