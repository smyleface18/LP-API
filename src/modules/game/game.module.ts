import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { QuestionModule } from '../question/question.module';

@Module({
  providers: [GameGateway, GameService],
  imports: [QuestionModule],
})
export class GameQuestionsModule {}
