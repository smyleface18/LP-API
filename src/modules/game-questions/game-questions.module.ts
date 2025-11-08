import { Module } from '@nestjs/common';
import { GameQuestionsService } from './game-questions.service';
import { GameQuestionsGateway } from './game-questions.gateway';
import { QuestionModule } from '../question/question.module';

@Module({
  providers: [GameQuestionsGateway, GameQuestionsService],
  imports: [QuestionModule],
})
export class GameQuestionsModule {}
