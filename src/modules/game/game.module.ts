import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { QuestionModule } from '../question/question.module';
import { CacheModule } from 'src/common/src/cache/cache.module';
import { MatchModule } from './match/match.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from 'src/db/database.module';
import { GameTimeoutQueue } from './queue/queue.service';

@Module({
  providers: [GameGateway, GameService, GameTimeoutQueue],
  imports: [QuestionModule, CacheModule, MatchModule, TypeOrmModule.forFeature(ENTITIES)],
})
export class GameModule {}
