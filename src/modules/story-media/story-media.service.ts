import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@/common/src/storage/storage.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator } from './image-generator';
import {
  GeneratedImage,
  PanelImageInput,
  PanelMediaRequest,
  PanelMediaResult,
} from './story-media.types';
import { seedForGame } from './panel-image-prompt';
import { IMAGE_RETRY_DELAYS_MS, StoryMediaExtension, storyMediaKey } from './story-media.config';

const IMAGE_EXTENSIONS: Record<string, StoryMediaExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Genera la media de una viñeta: narra el texto y la dibuja en paralelo, y
 * sube los dos archivos a S3 (bucket privado; las URLs se firman al enviar).
 *
 * - `status: 'ready'`: el audio se generó y se subió; `'failed'`: no hay audio.
 *   La viñeta se puede leer igual.
 * - `imageStatus`: `ready`, `failed` (el dibujante falló en todos los
 *   intentos, o no se pudo subir) o `none` (no hay proveedor de imágenes).
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
    const { gameId, storyId, order } = request;
    const [speech, image] = await Promise.all([
      this.speech.synthesize(request.text, request.languageCode),
      this.drawWithRetries(`story ${gameId} panel ${order}`, {
        seed: seedForGame(gameId),
        scene: request.scene,
        text: request.text,
        characters: request.characters,
      }),
    ]);

    const [audioKey, imageKey] = await Promise.all([
      speech && this.upload(storyMediaKey(storyId, order, 'mp3'), speech.audio, speech.contentType),
      image !== 'failed' &&
        image &&
        this.upload(
          storyMediaKey(storyId, order, IMAGE_EXTENSIONS[image.contentType] ?? 'png'),
          image.image,
          image.contentType,
        ),
    ]);

    const imageStatus = imageKey ? 'ready' : image === null ? 'none' : 'failed';
    this.logger.debug(`story ${gameId} panel ${order}: audio=${!!audioKey} image=${imageStatus}`);
    return audioKey
      ? {
          status: 'ready',
          audioKey,
          imageKey: imageKey || null,
          imageStatus,
          speechMarks: speech!.speechMarks,
        }
      : {
          status: 'failed',
          audioKey: null,
          imageKey: imageKey || null,
          imageStatus,
          speechMarks: null,
        };
  }

  /**
   * Dibuja la viñeta; si el dibujante lanza, reintenta tras cada espera de
   * IMAGE_RETRY_DELAYS_MS. `null` = no hay proveedor; `'failed'` = fallaron
   * todos los intentos.
   */
  private async drawWithRetries(
    label: string,
    input: PanelImageInput,
  ): Promise<GeneratedImage | null | 'failed'> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.images.generate(input);
      } catch (error) {
        const delay = IMAGE_RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `${label}: image attempt ${attempt + 1} failed: ${(error as Error).message}` +
            (delay === undefined ? '' : ` (retrying in ${delay} ms)`),
        );
        if (delay === undefined) return 'failed';
        await wait(delay);
      }
    }
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
