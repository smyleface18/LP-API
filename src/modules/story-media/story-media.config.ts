/** Tiempo máximo de la narración de una viñeta (las dos llamadas a Polly). */
export const SPEECH_TIMEOUT_MS = 15_000;

/** Tiempo máximo de cada intento de dibujar una viñeta. */
export const IMAGE_TIMEOUT_MS = 30_000;

/**
 * Esperas entre intentos de dibujar una viñeta (backoff exponencial): 1 intento
 * y un reintento por cada espera. Si fallan todos, la viñeta queda con
 * `imageStatus: 'failed'` y el review sigue con el audio.
 */
export const IMAGE_RETRY_DELAYS_MS = [1_000, 2_000] as const;

/** Largo máximo del prompt de la imagen (FLUX.1 schnell acepta hasta 2048). */
export const IMAGE_PROMPT_MAX_CHARS = 1024;

/** Modelo de Workers AI por defecto (`CF_IMAGE_MODEL`). */
export const CF_DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/** Pasos de difusión de FLUX.1 schnell (por defecto 4, máximo 8). */
export const CF_IMAGE_STEPS = 4;

/** Extensión de cada archivo de media en S3. */
export type StoryMediaExtension = 'mp3' | 'png' | 'jpg';

/** Carpeta de S3 de la media de una historieta. */
export const storyMediaKey = (storyId: string, order: number, extension: StoryMediaExtension) =>
  `story/${storyId}/panel-${order}.${extension}`;
