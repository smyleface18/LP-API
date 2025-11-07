import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GameQuestionsGatewayModule } from './game-questions-gateway/game-questions-gateway.module';

@Module({
  imports: [GameQuestionsGatewayModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
