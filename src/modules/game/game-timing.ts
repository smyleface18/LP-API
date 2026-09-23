/**
 * Tiempos del game loop (ms). El loop sigue una línea de tiempo absoluta en
 * hora del servidor: cada pregunta tiene `startsAt`/`endsAt` fijos que viajan
 * al cliente, y el scheduler (BullMQ) solo "despierta" al servidor para pasar
 * de fase — si se atrasa o adelanta no cambia lo que ven ni lo que se acepta.
 */

/** Cuenta regresiva entre startGame y la publicación de la primera pregunta. */
export const START_COUNTDOWN_MS = 3_000;

/**
 * Antelación con la que se envía la pregunta antes de mostrarla (`startsAt`):
 * cubre la latencia de red y la precarga de la media, para que todos la vean
 * a la vez. Mantenerlo corto: el contenido viaja antes de que empiece.
 */
export const QUESTION_LEAD_MS = 1_500;

/** Antelación mínima si el scheduler se atrasó y ya pasó el momento planeado. */
export const MIN_QUESTION_LEAD_MS = 500;

/** Tolerancia de red para respuestas que llegan justo después de `endsAt`. */
export const ANSWER_GRACE_MS = 500;

/** Pausa entre preguntas para mostrar el resultado antes de publicar la siguiente. */
export const REVEAL_MS = 3_000;
