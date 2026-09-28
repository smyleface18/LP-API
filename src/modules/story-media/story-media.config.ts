/** Tiempo máximo de la narración de una viñeta (las dos llamadas a Polly). */
export const SPEECH_TIMEOUT_MS = 15_000;

/** Tiempo máximo del dibujo de una viñeta (Nova Canvas tarda unos segundos). */
export const IMAGE_TIMEOUT_MS = 45_000;

/** Tamaño de las imágenes: 4:3, múltiplos de 16 como pide Nova Canvas. */
export const IMAGE_WIDTH = 1024;
export const IMAGE_HEIGHT = 768;

/** Nova Canvas acepta hasta 1024 caracteres de prompt. */
export const IMAGE_PROMPT_MAX_CHARS = 1024;

/** Carpeta de S3 de la media de una historieta. */
export const storyMediaKey = (storyId: string, order: number, extension: 'mp3' | 'png') =>
  `story/${storyId}/panel-${order}.${extension}`;
