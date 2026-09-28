import { Injectable } from '@nestjs/common';
import { GeneratedImage, PanelImageInput } from './story-media.types';

/**
 * Dibujante de las viñetas. Es también el token de inyección: el módulo usa
 * NovaCanvasImageService si hay `BEDROCK_IMAGE_MODEL_ID`, y NoImageGenerator si no.
 *
 * `generate` nunca lanza: sin imagen la viñeta queda igual `ready` si tiene audio.
 */
export abstract class ImageGenerator {
  abstract generate(input: PanelImageInput): Promise<GeneratedImage | null>;
}

/** Sin imágenes (no configurado, o en tests). */
@Injectable()
export class NoImageGenerator extends ImageGenerator {
  generate(): Promise<null> {
    return Promise.resolve(null);
  }
}
