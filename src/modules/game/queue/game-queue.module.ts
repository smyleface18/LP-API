import { Module } from '@nestjs/common';
import { GameTimeoutQueue } from './queue.service';
import { GameTimeoutProcessor } from './queue.processor';
import { EnvsService } from 'src/common/src/envs/envs.service';
import { EnvsModule } from 'src/common/src/envs/envs.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  providers: [GameTimeoutQueue, GameTimeoutProcessor],
  imports: [
    BullModule.registerQueueAsync({
      name: 'game-question-timeout',
      imports: [EnvsModule],
      useFactory: (envs: EnvsService) => ({
        connection: {
          host: envs.redisHost,
          port: envs.redisPort,
        },
      }),
      inject: [EnvsService],
    }),
  ],
  exports: [],
})
export class GameQueueModule {}
