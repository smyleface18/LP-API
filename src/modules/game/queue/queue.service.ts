import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { EnvsService } from 'src/common/src/envs/envs.service';
import { TimeoutDto } from '../types';

@Injectable()
export class GameTimeoutQueue {
  private readonly queueEvents: QueueEvents;
  constructor(
    @InjectQueue('game-question-timeout')
    private readonly queue: Queue,
    private readonly envsService: EnvsService,
  ) {}

  async createTimeout(timeoutDto: TimeoutDto): Promise<void> {
    await this.queue.add(
      `end-question-roomId-${timeoutDto.roomId}`,
      {
        roomId: timeoutDto.roomId,
      },
      {
        delay: timeoutDto.timeLimit * 1000,
        removeOnComplete: true,
      },
    );
  }
}
