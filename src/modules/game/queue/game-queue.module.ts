import { Module } from '@nestjs/common';
import { GameTimeoutQueue } from './queue.service';
import { GameTimeoutProcessor } from './queue.processor';
import { EnvsService } from 'src/common/src/envs/envs.service';
import { EnvsModule } from 'src/common/src/envs/envs.module';
import { BullModule } from '@nestjs/bullmq';
import { GameModule } from '../game.module';

@Module({
  providers: [GameTimeoutQueue, GameTimeoutProcessor],
  imports: [
    GameModule,
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
  exports: [GameTimeoutQueue],
})
export class GameQueueModule {}
