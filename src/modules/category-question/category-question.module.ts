import { Module } from '@nestjs/common';
import { CategoryQuestionService } from './category-question.service';
import { CategoryQuestionController } from './category-question.controller';

@Module({
  controllers: [CategoryQuestionController],
  providers: [CategoryQuestionService],
})
export class CategoryQuestionModule {}
