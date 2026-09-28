import { Injectable } from '@nestjs/common';
import { GeneratedImage, PanelImageInput } from './story-media.types';

/**
 * Dibujante de las viñetas. Es también el token de inyección: el módulo elige
 * la implementación con `IMAGE_PROVIDER` (ver `createImageGenerator`).
 *
 * - Devuelve `null` si no hay proveedor configurado (la viñeta queda con
 *   `imageStatus: 'none'`).
 * - Lanza si el proveedor falla: `StoryMediaService` reintenta con backoff y,
 *   si sigue fallando, la viñeta queda con `imageStatus: 'failed'`.
 */
export abstract class ImageGenerator {
  abstract generate(input: PanelImageInput): Promise<GeneratedImage | null>;
}

/** Sin imágenes (`IMAGE_PROVIDER=none`, o en tests). */
@Injectable()
export class NullImageGenerator extends ImageGenerator {
  generate(): Promise<null> {
    return Promise.resolve(null);
  }
}
