import { Level } from '@/db/enum/question.enum';
import { REVIEW_TIMEOUT_MS } from '@/modules/language-review/language-review.config';

/**
 * Reglas del modo Historieta. Toda la lógica (servicio y DTOs) lee de acá;
 * no repetir estos números en otro lado.
 */

export const STORY_MIN_PLAYERS = 2;
export const STORY_MAX_PLAYERS = 6;

export const STORY_PANELS_MIN = 4;
export const STORY_PANELS_MAX = 10;

export const STORY_TURN_DURATIONS_SEC = [60, 90, 120, 180] as const;
export const STORY_LEVELS = [Level.A1, Level.A2, Level.B1, Level.B2] as const;
export const STORY_LANGUAGES = ['en-US'] as const;

export type StoryTurnDurationSec = (typeof STORY_TURN_DURATIONS_SEC)[number];
export type StoryLevel = (typeof STORY_LEVELS)[number];
export type StoryLanguage = (typeof STORY_LANGUAGES)[number];

export const STORY_DEFAULT_CONFIG = {
  panelsCount: 6,
  turnDurationSec: 90 as StoryTurnDurationSec,
  level: Level.A2 as StoryLevel,
  language: 'en-US' as StoryLanguage,
  shareDrafts: true,
};

/**
 * Cuánto espera una partida en LOBBY o PLAYING sin nadie conectado antes de
 * pasar a ABANDONED. Un redeploy desconecta todos los sockets a la vez: sin
 * este margen, cada deploy mataría las partidas en curso.
 */
export const IDLE_ABANDON_DELAY_MS = 60_000;

/** Revisiones de IA que puede usar un jugador en su viñeta. */
export const MAX_REVIEW_ATTEMPTS = 2;
export const MAX_CHARS_PER_PANEL = 320;
export const MIN_WORDS_PER_PANEL = 8;
export const MAX_CHARS_PER_SCENE = 200;

/** Tope de envíos de borrador por turno, consuman o no intento (flagged, IA caída). */
export const MAX_DRAFTS_PER_TURN = 5;

/**
 * Una revisión en curso más vieja que esto se da por perdida (ej. la instancia
 * murió mientras esperaba a la IA) y el autor puede volver a enviar.
 */
export const REVIEW_STALE_MS = REVIEW_TIMEOUT_MS + 4_000;

/**
 * Si el turno vence con una revisión en curso, se espera su resultado para
 * cerrar con ese borrador. Como respaldo, `close-turn` se reprograma para
 * `inicio de la revisión + REVIEW_TIMEOUT_MS + este margen`.
 */
export const REVIEW_CLOSE_GRACE_MS = 2_000;

/** Texto de una viñeta cuyo turno venció sin ningún borrador. */
export const OUT_OF_TIME_TEXT = '(The author ran out of time.)';

/**
 * Puntuación por viñeta (ver calculatePanelScore). La calcula el servidor a
 * partir de la cantidad de errores; nunca se usa un puntaje del modelo.
 */
/** Cuánto pesa cada error en la precisión: 100 × (1 − peso × errores / palabras). */
export const SCORE_ERROR_WEIGHT = 3;
/** 0 errores en la primera revisión. */
export const SCORE_FIRST_TRY_BONUS = 50;
/** La segunda revisión tiene menos errores que la primera. */
export const SCORE_SELF_CORRECTION_BONUS = 25;
/** Puntaje fijo si la IA no pudo revisar el texto final: no se castiga al jugador. */
export const SCORE_REVIEW_UNAVAILABLE = 60;

/** Reacciones permitidas a una viñeta confirmada (una por jugador y viñeta). */
export const STORY_REACTIONS = ['👏', '😂', '😮', '❤️', '🔥'] as const;
export type StoryReaction = (typeof STORY_REACTIONS)[number];

/** Personajes: se crean durante los turnos. */
export const MAX_CHARACTERS_PER_STORY = 6;
export const MAX_NEW_CHARACTERS_PER_PANEL = 2;
export const MAX_CHARACTERS_PER_PANEL = 3;

/** Largo máximo de cada campo de la ficha de personaje. */
export const CHARACTER_LIMITS = {
  name: 30,
  kind: 30,
  description: 100,
} as const;
