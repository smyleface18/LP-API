import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TimeoutDto } from '../types';
import { OnEvent } from '@nestjs/event-emitter';
import { GameQueueEvent } from './type';

@Injectable()
export class GameTimeoutQueue {
  private readonly logger = new Logger(GameTimeoutQueue.name);
  constructor(
    @InjectQueue('game-question-timeout')
    private readonly queue: Queue,
  ) {}

  async scheduleQuestionEnd(timeoutDto: TimeoutDto): Promise<void> {
    this.logger.debug(`scheduling question end for room ${timeoutDto.roomId}`);
    await this.queue.add(
      `end-question-roomId-${timeoutDto.roomId}`,
      {
        roomId: timeoutDto.roomId,
      },
      {
        jobId: `end-question-roomId-${timeoutDto.roomId}-+${Date.now()}`,
        delay: timeoutDto.timeLimit * 1000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async scheduleQuestionStart(payload: { roomId: string; delay: number }): Promise<void> {
    this.logger.debug(`scheduling question start for room ${payload.roomId}`);
    await this.queue.add(
      `start-question-roomId-${payload.roomId}`,
      {
        roomId: payload.roomId,
      },
      {
        jobId: `start-question-roomId-${payload.roomId}-+${Date.now()}`,
        delay: payload.delay,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  @OnEvent('game.starting')
  async handleGameStarting(payload: GameQueueEvent) {
    if (payload.delay === undefined) return;
    await this.scheduleQuestionStart({
      roomId: payload.roomId,
      delay: payload.delay,
    });
  }

  @OnEvent('question.started')
  async handleQuestionStarted(payload: { roomId: string; timeLimit: number }) {
    await this.scheduleQuestionEnd({
      roomId: payload.roomId,
      timeLimit: payload.timeLimit,
    });
  }

  @OnEvent('game.question-ended')
  async handleQuestionEnded(payload: GameQueueEvent) {
    if (payload.delay === undefined) return;
    await this.scheduleQuestionStart({
      roomId: payload.roomId,
      delay: payload.delay,
    });
  }
}
