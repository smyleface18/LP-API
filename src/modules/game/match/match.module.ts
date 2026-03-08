import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { CacheModule } from 'src/common/src/cache/cache.module';
import { QuestionModule } from 'src/modules/question/question.module';

@Module({
  providers: [MatchService],
  imports: [CacheModule, QuestionModule],
  exports: [MatchService],
})
export class MatchModule {}
