import { Level } from '@/db/enum/question.enum';

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
};

/** Cuánto espera un lobby sin nadie conectado antes de pasar a ABANDONED. */
export const LOBBY_ABANDON_DELAY_MS = 60_000;

/** Revisiones de IA que puede usar un jugador en su viñeta. */
export const MAX_REVIEW_ATTEMPTS = 2;
export const MAX_CHARS_PER_PANEL = 320;
export const MIN_WORDS_PER_PANEL = 8;
export const MAX_CHARS_PER_SCENE = 200;

/** Personajes: se crean durante los turnos (Fase 2). */
export const MAX_CHARACTERS_PER_STORY = 6;
export const MAX_NEW_CHARACTERS_PER_PANEL = 2;
export const MAX_CHARACTERS_PER_PANEL = 3;

/** Largo máximo de cada campo de la ficha de personaje. */
export const CHARACTER_LIMITS = {
  name: 30,
  kind: 30,
  description: 100,
} as const;
