import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { MatchResultsService } from './match-results.service';
import { QuestionModule } from '@/modules/question/question.module';
import { UniqueNamesModule } from '@/common/src/unique-names/unique-names.module';
import { RedisModule } from '@/common/src/redis/redis.module';
import { MatchStore } from './match.store';

@Module({
  providers: [MatchService, MatchResultsService, MatchStore],
  imports: [RedisModule, QuestionModule, UniqueNamesModule],
  exports: [MatchService],
})
export class MatchModule {}
