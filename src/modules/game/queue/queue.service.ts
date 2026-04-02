import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TimeoutDto } from '../types';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class GameTimeoutQueue {
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
        delay: timeoutDto.timeLimit,
        removeOnComplete: true,
      },
    );
  }

  @OnEvent('question.started')
  async handleQuestionStarted(payload: { roomId: string; timeLimit: number }) {
    await this.scheduleNextQuestion({
      roomId: payload.roomId,
      timeLimit: payload.timeLimit,
    });
  }
}
