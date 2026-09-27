import { Module } from '@nestjs/common';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { LanguageReviewer } from './language-reviewer';
import { BEDROCK_CLIENT, LanguageReviewService } from './language-review.service';

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
  ],
  exports: [LanguageReviewer],
})
export class LanguageReviewModule {}
