import { Module } from '@nestjs/common';
import { QuestionOptionsService } from './question-options.service';
import { QuestionOptionsController } from './question-options.controller';

@Module({
  controllers: [QuestionOptionsController],
  providers: [QuestionOptionsService],
})
export class QuestionOptionsModule {}
