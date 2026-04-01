import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { TimeoutDto } from '../types';

@Injectable()
export class GameTimeoutQueue {
  private readonly queueEvents: QueueEvents;
  constructor(
    @InjectQueue('game-question-timeout')
    private readonly queue: Queue,
  ) {}

  async scheduleNextQuestion(timeoutDto: TimeoutDto): Promise<void> {
    console.log('add timeout');
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
