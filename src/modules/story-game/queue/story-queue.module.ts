import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvsModule } from '@/common/src/envs/envs.module';
import { EnvsService } from '@/common/src/envs/envs.service';
import { StoryGameModule } from '../story-game.module';
import { StoryTimeoutQueue } from './story-timeout.queue';
import { StoryTimeoutProcessor } from './story-timeout.processor';
import { STORY_TIMEOUT_QUEUE } from './type';

@Module({
  providers: [StoryTimeoutQueue, StoryTimeoutProcessor],
  imports: [
    StoryGameModule,
    BullModule.registerQueueAsync({
      name: STORY_TIMEOUT_QUEUE,
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
})
export class StoryQueueModule {}
