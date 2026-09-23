import { Module } from '@nestjs/common';
import { QuestionOptionsService } from './question-options.service';
import { QuestionOptionsController } from './question-options.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from '@/db/database.module';
import { MediaModule } from '../media/media.module';

@Module({
  controllers: [QuestionOptionsController],
  imports: [TypeOrmModule.forFeature(ENTITIES), MediaModule],
  providers: [QuestionOptionsService],
})
export class QuestionOptionsModule {}
