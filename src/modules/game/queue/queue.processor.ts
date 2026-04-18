import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GameService } from '../game.service';
import { GameQueueJobPayload } from './type';

@Processor('game-question-timeout')
export class GameTimeoutProcessor extends WorkerHost {
  constructor(private readonly gameService: GameService) {
    super();
  }

  async process(job: Job<GameQueueJobPayload, any, string>) {
    console.log('processing job', job.name, job.data);
    const roomId = job.data.roomId;

    if (job.name.startsWith('start-question-roomId-')) {
      await this.gameService.startQuestion(roomId);
      return;
    }

    if (job.name.startsWith('end-question-roomId-')) {
      await this.gameService.handleQuestionTimeout(roomId);
      return;
    }

    console.warn(`Unknown job name: ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GameQueueJobPayload, any, string>) {
    console.log(`Job completado: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GameQueueJobPayload, any, string>) {
    console.error(`Job falló: ${job.id}`);
    console.error(job.failedReason);
    console.error(job.stacktrace);
  }
}
