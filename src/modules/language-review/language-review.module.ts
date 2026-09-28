import { Module } from '@nestjs/common';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { LanguageReviewer } from './language-reviewer';
import { BEDROCK_CLIENT, LanguageReviewService } from './language-review.service';
import { StoryTitler } from './story-titler';
import { BedrockStoryTitler } from './bedrock-story-titler';

@Module({
  providers: [
    {
      provide: BEDROCK_CLIENT,
      inject: [EnvsService],
      // maxAttempts 1: los reintentos (y su presupuesto de tiempo) los maneja el servicio.
      useFactory: (envs: EnvsService) =>
        new BedrockRuntimeClient({ region: envs.bedrockRegion, maxAttempts: 1 }),
    },
    { provide: LanguageReviewer, useClass: LanguageReviewService },
    { provide: StoryTitler, useClass: BedrockStoryTitler },
  ],
  exports: [LanguageReviewer, StoryTitler],
})
export class LanguageReviewModule {}
