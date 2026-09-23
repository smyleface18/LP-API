import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from '@/db/database.module';
import { MediaModule } from '../media/media.module';

@Module({
  controllers: [QuestionController],
  providers: [QuestionService],
  imports: [TypeOrmModule.forFeature(ENTITIES), MediaModule],
  exports: [QuestionService],
})
export class QuestionModule {}
