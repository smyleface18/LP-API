import { Module } from '@nestjs/common';
import { PollyClient } from '@aws-sdk/client-polly';
import { EnvsService } from '@/common/src/envs/envs.service';
import { StorageModule } from '@/common/src/storage/storage.module';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator } from './image-generator';
import { createImageGenerator } from './image-generator.factory';
import { POLLY_CLIENT, PollySpeechService } from './polly-speech.service';
import { StoryMediaService } from './story-media.service';

/** Media del modo Historieta: narración con Polly e imágenes según IMAGE_PROVIDER. */
@Module({
  imports: [StorageModule],
  providers: [
    {
      provide: POLLY_CLIENT,
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => new PollyClient({ region: envs.pollyRegion }),
    },
    { provide: SpeechSynthesizer, useClass: PollySpeechService },
    {
      // IMAGE_PROVIDER: none (por defecto) | cloudflare. Mal configurado, la app no arranca.
      provide: ImageGenerator,
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => createImageGenerator(envs),
    },
    StoryMediaService,
  ],
  exports: [StoryMediaService],
})
export class StoryMediaModule {}
