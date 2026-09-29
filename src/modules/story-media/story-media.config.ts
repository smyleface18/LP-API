/** Tiempo máximo de la narración de una viñeta (las dos llamadas a Polly). */
export const SPEECH_TIMEOUT_MS = 15_000;

/** Tiempo máximo de cada intento de dibujar una viñeta. Se cambia con `IMAGE_TIMEOUT_MS`. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 30_000;

/**
 * Esperas entre intentos de dibujar una viñeta tras un error `transient`
 * (backoff exponencial): hasta 5 intentos. Si fallan todos, la viñeta queda
 * con `imageStatus: 'failed'` y el review sigue con el audio. Workers AI a
 * veces tarda más de lo normal durante un rato: con 5 intentos de 30 s una
 * imagen puede esperar hasta ~2 min 45 s (5 × 30 s + 15 s de esperas).
 */
export const IMAGE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/** Largo máximo del prompt de la imagen (FLUX.1 schnell acepta hasta 2048). */
export const IMAGE_PROMPT_MAX_CHARS = 1024;

/**
 * Topes de cada parte del prompt. En el peor caso, estilo + escenario + 3
 * fichas ocupan 911 caracteres: las fichas nunca se cortan y a la acción le
 * quedan al menos 112 (lo comprueba panel-image-prompt.spec.ts).
 * Coinciden con los límites del borrador (escenario 200; ficha: nombre 30,
 * tipo 30, descripción 100; 3 personajes por viñeta), así que con datos
 * válidos no se recorta nada salvo la acción.
 */
export const PROMPT_MAX_SCENE_CHARS = 200;
export const PROMPT_MAX_CHARACTER_CHARS = 30 + ' is a '.length + 30 + ': '.length + 100;
export const PROMPT_MAX_CHARACTERS = 3;

/** Modelo de Workers AI por defecto (`CF_IMAGE_MODEL`). */
export const CF_DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/** Pasos de difusión de FLUX.1 schnell (por defecto 4, máximo 8). */
export const CF_IMAGE_STEPS = 4;

/** Extensión de cada archivo de media en S3. */
export type StoryMediaExtension = 'mp3' | 'png' | 'jpg';

/** Carpeta de S3 de la media de una historieta. */
export const storyMediaKey = (storyId: string, order: number, extension: StoryMediaExtension) =>
  `story/${storyId}/panel-${order}.${extension}`;
