import { Module } from '@nestjs/common';
import { PollyClient } from '@aws-sdk/client-polly';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { StorageModule } from '@/common/src/storage/storage.module';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator, NoImageGenerator } from './image-generator';
import { POLLY_CLIENT, PollySpeechService } from './polly-speech.service';
import { IMAGE_BEDROCK_CLIENT, NovaCanvasImageService } from './nova-canvas-image.service';
import { StoryMediaService } from './story-media.service';

/** Media del modo Historieta (Fase 4b): narración con Polly e imágenes con Nova Canvas. */
@Module({
  imports: [StorageModule],
  providers: [
    {
      provide: POLLY_CLIENT,
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => new PollyClient({ region: envs.pollyRegion }),
    },
    {
      provide: IMAGE_BEDROCK_CLIENT,
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => new BedrockRuntimeClient({ region: envs.bedrockRegion }),
    },
    { provide: SpeechSynthesizer, useClass: PollySpeechService },
    NovaCanvasImageService,
    {
      // Sin BEDROCK_IMAGE_MODEL_ID las historietas se generan sin imágenes.
      provide: ImageGenerator,
      inject: [EnvsService, NovaCanvasImageService],
      useFactory: (envs: EnvsService, novaCanvas: NovaCanvasImageService) =>
        envs.bedrockImageModelId ? novaCanvas : new NoImageGenerator(),
    },
    StoryMediaService,
  ],
  exports: [StoryMediaService],
})
export class StoryMediaModule {}
