import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { QuestionModule } from '../question/question.module';
import { CacheModule } from 'src/common/src/cache/cache.module';
import { MatchModule } from './match/match.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from 'src/db/database.module';
import { BullModule } from '@nestjs/bullmq';
import { EnvsModule } from 'src/common/src/envs/envs.module';
import { EnvsService } from 'src/common/src/envs/envs.service';

@Module({
  providers: [GameGateway, GameService],
  imports: [
    QuestionModule,
    CacheModule,
    MatchModule,
    TypeOrmModule.forFeature(ENTITIES),
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
})
export class GameModule {}
