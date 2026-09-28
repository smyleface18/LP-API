import { Injectable } from '@nestjs/common';
import { GeneratedImage, PanelImageInput } from './story-media.types';

/**
 * Por qué falló el proveedor, para decidir si se reintenta:
 * - `permanent`: la petición no va a funcionar repitiéndola (400, 401, 403,
 *   otro 4xx, o una respuesta sin imagen). Sin reintento.
 * - `rate-limited`: se superó la cuota (429). Sin reintento, y las viñetas que
 *   falten de la historieta no llaman al proveedor.
 * - `transient`: 5xx, timeout o error de red. Hasta 3 intentos.
 */
export type ImageFailureKind = 'permanent' | 'rate-limited' | 'transient';

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly kind: ImageFailureKind,
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Dibujante de las viñetas. Es también el token de inyección: el módulo elige
 * la implementación con `IMAGE_PROVIDER` (ver `createImageGenerator`).
 *
 * - Devuelve `null` si no hay proveedor configurado (la viñeta queda con
 *   `imageStatus: 'none'`).
 * - Lanza si el proveedor falla, idealmente un `ImageGenerationError` con su
 *   `kind`; cualquier otro error cuenta como `transient`.
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
