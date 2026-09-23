import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { MatchResultsService } from './match-results.service';
import { QuestionModule } from '@/modules/question/question.module';
import { UniqueNamesModule } from '@/common/src/unique-names/unique-names.module';
import { CacheModule } from '@/common/src/cache/cache.module';

@Module({
  providers: [MatchService, MatchResultsService],
  imports: [CacheModule, QuestionModule, UniqueNamesModule],
  exports: [MatchService],
})
export class MatchModule {}
