import { Module } from '@nestjs/common';
import { GameQuestionsService } from './game-questions.service';
import { GameQuestionsGateway } from './game-questions.gateway';

@Module({
  providers: [GameQuestionsGateway, GameQuestionsService],
})
export class GameQuestionsModule {}
