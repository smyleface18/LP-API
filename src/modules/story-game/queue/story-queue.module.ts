import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvsModule } from '@/common/src/envs/envs.module';
import { EnvsService } from '@/common/src/envs/envs.service';
import { StoryGameModule } from '../story-game.module';
import { StoryTimeoutQueue } from './story-timeout.queue';
import { StoryTimeoutProcessor } from './story-timeout.processor';
import { StoryMediaQueue } from './story-media.queue';
import { StoryMediaProcessor } from './story-media.processor';
import { StoryMediaModule } from '@/modules/story-media/story-media.module';
import { STORY_MEDIA_QUEUE, STORY_TIMEOUT_QUEUE } from './type';

@Module({
  providers: [StoryTimeoutQueue, StoryTimeoutProcessor, StoryMediaQueue, StoryMediaProcessor],
  imports: [
    StoryGameModule,
    StoryMediaModule,
    ...[STORY_TIMEOUT_QUEUE, STORY_MEDIA_QUEUE].map((name) =>
      BullModule.registerQueueAsync({
        name,
        imports: [EnvsModule],
        useFactory: (envs: EnvsService) => ({
          connection: {
            host: envs.redisHost,
            port: envs.redisPort,
          },
        }),
        inject: [EnvsService],
      }),
    ),
  ],
})
export class StoryQueueModule {}
