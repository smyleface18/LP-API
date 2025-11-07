import { Module } from '@nestjs/common';
import { GameQuestionsGatewayService } from './game-questions-gateway.service';
import { GameQuestionsGateway } from './game-questions.gateway';

@Module({
  controllers: [],
  providers: [GameQuestionsGatewayService, GameQuestionsGateway],
  exports: [GameQuestionsGatewayService],
})
export class GameQuestionsGatewayModule {}
