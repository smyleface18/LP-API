import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TimeoutDto } from '../types';
import { GameService } from '../game.service';

@Processor('game-question-timeout')
export class GameTimeoutProcessor extends WorkerHost {
  constructor(private readonly gameService: GameService) {
    super();
  }

  async process(job: Job<TimeoutDto>) {
    console.log('en el process');
    await this.gameService.handleQuestionTimeout(job.data.roomId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Job completado: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job) {
    console.error(`Job falló: ${job.id}`);
  }
}
