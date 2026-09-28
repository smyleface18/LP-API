/**
 * Tiempo total que puede tardar una revisión de inglés, incluido su reintento.
 * Pasado este tiempo la revisión devuelve null y el juego sigue sin ella.
 */
export const REVIEW_TIMEOUT_MS = 8_000;

/** Tiempo máximo del título de una historieta (una sola llamada). */
export const STORY_TITLE_TIMEOUT_MS = 8_000;

/** Largo máximo del título (se corta en la última palabra que entra). */
export const STORY_TITLE_MAX_CHARS = 60;
