import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './db/database.module';
import { GameModule } from './modules/game/game.module';
import { QuestionModule } from './modules/question/question.module';
import { CategoryQuestionModule } from './modules/category-question/category-question.module';
import { QuestionOptionsModule } from './modules/question-options/question-options.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommonModule } from './common/src/common.module';
import { MatchModule } from './modules/game/match/match.module';

@Module({
  imports: [
    DatabaseModule,
    GameModule,
    QuestionModule,
    CategoryQuestionModule,
    QuestionOptionsModule,
    AuthModule,
    CommonModule,
    MatchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
