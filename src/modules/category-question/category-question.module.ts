import { Module } from '@nestjs/common';
import { CategoryQuestionService } from './category-question.service';
import { CategoryQuestionController } from './category-question.controller';
import { ENTITIES } from 'src/db/database.module';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  controllers: [CategoryQuestionController],
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [CategoryQuestionService],
})
export class CategoryQuestionModule {}
