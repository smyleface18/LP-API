import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@/db/entities';
import { RedisModule } from '@/common/src/redis/redis.module';
import { StorageModule } from '@/common/src/storage/storage.module';
import { WsAuthModule } from '@/common/src/ws-auth/ws-auth.module';
import { UniqueNamesModule } from '@/common/src/unique-names/unique-names.module';
import { LanguageReviewModule } from '@/modules/language-review/language-review.module';
import { StoryGameGateway } from './story-game.gateway';
import { StoryGameService } from './story-game.service';
import { StoryStateRepository } from './story-state.repository';
import { StoryUrlSigner } from './story-url-signer.service';

@Module({
  imports: [
    RedisModule,
    StorageModule,
    WsAuthModule,
    UniqueNamesModule,
    LanguageReviewModule,
    TypeOrmModule.forFeature([User]),
  ],
  providers: [StoryGameGateway, StoryGameService, StoryStateRepository, StoryUrlSigner],
  exports: [StoryGameService, StoryUrlSigner],
})
export class StoryGameModule {}
