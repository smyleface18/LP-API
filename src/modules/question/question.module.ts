import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from 'src/db/database.module';

@Module({
  controllers: [QuestionController],
  providers: [QuestionService],
  imports: [TypeOrmModule.forFeature(Object.values(ENTITIES))],
  exports: [QuestionService],
})
export class QuestionModule {}
