import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TimeoutDto } from '../types';
import { MatchService } from '../match/match.service';

@Processor('game-question-timeout')
export class GameTimeoutProcessor extends WorkerHost {
  constructor(private readonly matchService: MatchService) {
    super();
  }

  async process(job: Job<TimeoutDto>) {
    await this.matchService.nextQuestion(job.data.roomId);
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
