import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { QuestionModule } from '../question/question.module';
import { CacheModule } from 'src/common/src/cache/cache.module';

@Module({
  providers: [GameGateway, GameService],
  imports: [QuestionModule, CacheModule],
})
export class GameQuestionsModule {}
