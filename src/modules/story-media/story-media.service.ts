import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@/common/src/storage/storage.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageFailureKind, ImageGenerationError, ImageGenerator } from './image-generator';
import {
  GeneratedImage,
  PanelAudioResult,
  PanelImageInput,
  PanelImageResult,
  PanelMediaRequest,
} from './story-media.types';
import { seedForGame } from './panel-image-prompt';
import { IMAGE_RETRY_DELAYS_MS, StoryMediaExtension, storyMediaKey } from './story-media.config';

const IMAGE_EXTENSIONS: Record<string, StoryMediaExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Un error que no es `ImageGenerationError` (ej. un bug del adaptador) se trata como pasajero. */
const failureKindOf = (error: unknown): ImageFailureKind =>
  error instanceof ImageGenerationError ? error.kind : 'transient';

/**
 * Genera la media de una viñeta y la sube a S3 (bucket privado; las URLs se
 * firman al enviar). El audio y la imagen son tareas separadas: la viñeta
 * queda lista con el audio, y la imagen llega después.
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

  /** Narra el texto: `ready` si el audio se generó y se subió, `failed` si no. */
  async generateAudio(request: PanelMediaRequest): Promise<PanelAudioResult> {
    const { gameId, storyId, order } = request;
    const speech = await this.speech.synthesize(request.text, request.languageCode);
    const audioKey =
      speech &&
      (await this.upload(storyMediaKey(storyId, order, 'mp3'), speech.audio, speech.contentType));

    this.logger.debug(`story ${gameId} panel ${order}: audio=${!!audioKey}`);
    if (!speech || !audioKey) return { status: 'failed', audioKey: null, speechMarks: null };
    return { status: 'ready', audioKey, speechMarks: speech.speechMarks };
  }

  /**
   * Dibuja la viñeta: `ready` si la imagen se generó y se subió, `none` si no
   * hay proveedor, `failed` si el proveedor falló (ver `drawWithRetries`) o no
   * se pudo subir. `rateLimited` avisa que las demás viñetas no deben pedirla.
   */
  async generateImage(request: PanelMediaRequest): Promise<PanelImageResult> {
    const { gameId, storyId, order } = request;
    const drawn = await this.drawWithRetries(`story ${gameId} panel ${order}`, {
      seed: seedForGame(gameId),
      scene: request.scene,
      text: request.text,
      characters: request.characters,
    });

    if (drawn === null) return { imageStatus: 'none', imageKey: null };
    if ('failure' in drawn) {
      return {
        imageStatus: 'failed',
        imageKey: null,
        rateLimited: drawn.failure === 'rate-limited',
      };
    }

    const { image, contentType } = drawn;
    const extension = IMAGE_EXTENSIONS[contentType] ?? 'png';
    const imageKey = await this.upload(
      storyMediaKey(storyId, order, extension),
      image,
      contentType,
    );
    this.logger.debug(`story ${gameId} panel ${order}: image=${!!imageKey}`);
    return imageKey
      ? { imageStatus: 'ready', imageKey }
      : { imageStatus: 'failed', imageKey: null };
  }

  /**
   * Dibuja la viñeta según el tipo de error: `transient` se reintenta tras
   * cada espera de IMAGE_RETRY_DELAYS_MS (hasta 5 intentos); `permanent` y
   * `rate-limited` no se reintentan. `null` = no hay proveedor.
   */
  private async drawWithRetries(
    label: string,
    input: PanelImageInput,
  ): Promise<GeneratedImage | null | { failure: ImageFailureKind }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.images.generate(input);
      } catch (error) {
        const failure = failureKindOf(error);
        const delay = failure === 'transient' ? IMAGE_RETRY_DELAYS_MS[attempt] : undefined;
        this.logger.warn(
          `${label}: image attempt ${attempt + 1} failed (${failure}): ${(error as Error).message}` +
            (delay === undefined ? '' : ` (retrying in ${delay} ms)`),
        );
        if (delay === undefined) return { failure };
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
