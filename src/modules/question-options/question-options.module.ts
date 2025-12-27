import { Module } from '@nestjs/common';
import { QuestionOptionsService } from './question-options.service';
import { QuestionOptionsController } from './question-options.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from 'src/db/database.module';

@Module({
  controllers: [QuestionOptionsController],
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [QuestionOptionsService],
})
export class QuestionOptionsModule {}
