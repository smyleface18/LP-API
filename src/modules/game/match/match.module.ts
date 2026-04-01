import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { QuestionModule } from 'src/modules/question/question.module';
import { UniqueNamesModule } from 'src/common/src/unique-names/unique-names.module';
import { CacheModule } from 'src/common/src/cache/cache.module';

@Module({
  providers: [MatchService],
  imports: [CacheModule, QuestionModule, UniqueNamesModule],
  exports: [MatchService],
})
export class MatchModule {}
