import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { EnvsService } from 'src/common/src/envs/envs.service';

@Injectable()
export class GameTimeoutQueue {
  private readonly queueEvents: QueueEvents;
  constructor(
    @InjectQueue('game-question-timeout')
    private readonly queue: Queue,
    private readonly envsService: EnvsService,
  ) {
    this.queueEvents = new QueueEvents('orders', {
      connection: {
        host: this.envsService.dbHost,
        port: this.envsService.port,
      },
    });
  }

  async sendTimeout(order: any): Promise<void> {
    // todo: implement methodo sendTimeout
  }
}
