import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@/common/src/storage/storage.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator } from './image-generator';
import { PanelMediaRequest, PanelMediaResult } from './story-media.types';
import { seedForStory } from './panel-image-prompt';
import { storyMediaKey } from './story-media.config';

/**
 * Genera la media de una viñeta: narra el texto y la dibuja en paralelo, y
 * sube los dos archivos a S3 (bucket privado; las URLs se firman al enviar).
 *
 * - `ready`: el audio se generó y se subió. La imagen es opcional.
 * - `failed`: no hay audio. La viñeta se puede leer igual.
 *
 * Nunca lanza: un error de S3 cuenta como que ese archivo no se generó.
 */
@Injectable()
export class StoryMediaService {
  private readonly logger = new Logger(StoryMediaService.name);

  constructor(
    private readonly speech: SpeechSynthesizer,
    private readonly images: ImageGenerator,
    private readonly storage: StorageService,
  ) {}

  async generatePanel(request: PanelMediaRequest): Promise<PanelMediaResult> {
    const { storyId, order } = request;
    const [speech, image] = await Promise.all([
      this.speech.synthesize(request.text, request.languageCode),
      this.images.generate({
        seed: seedForStory(storyId),
        scene: request.scene,
        text: request.text,
        characters: request.characters,
      }),
    ]);

    const [audioKey, imageKey] = await Promise.all([
      speech && this.upload(storyMediaKey(storyId, order, 'mp3'), speech.audio, speech.contentType),
      image && this.upload(storyMediaKey(storyId, order, 'png'), image.image, image.contentType),
    ]);

    this.logger.debug(
      `story ${request.gameId} panel ${order}: audio=${!!audioKey} image=${!!imageKey}`,
    );
    return audioKey
      ? { status: 'ready', audioKey, imageKey: imageKey ?? null, speechMarks: speech!.speechMarks }
      : { status: 'failed', audioKey: null, imageKey: imageKey ?? null, speechMarks: null };
  }

  private async upload(key: string, body: Uint8Array, contentType: string): Promise<string | null> {
    try {
      await this.storage.putObject(key, body, contentType);
      return key;
    } catch (error) {
      this.logger.warn(`could not upload ${key}: ${(error as Error).message}`);
      return null;
    }
  }
}
