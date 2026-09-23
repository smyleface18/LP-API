import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { MatchResultsService } from './match-results.service';
import { QuestionModule } from '@/modules/question/question.module';
import { UniqueNamesModule } from '@/common/src/unique-names/unique-names.module';
import { RedisModule } from '@/common/src/redis/redis.module';
import { MatchStore } from './match.store';
import { MediaModule } from '@/modules/media/media.module';

@Module({
  providers: [MatchService, MatchResultsService, MatchStore],
  imports: [RedisModule, QuestionModule, UniqueNamesModule, MediaModule],
  exports: [MatchService],
})
export class MatchModule {}
