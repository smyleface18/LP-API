import { StoryLanguage, StoryLevel, StoryTurnDurationSec } from '../story-game.config';

/**
 * Estados de la partida. Solo el servidor los cambia:
 *   LOBBY → PLAYING → PROCESSING → REVIEW → FINISHED
 *   cualquiera → ABANDONED (no quedan jugadores conectados; en LOBBY tras una espera)
 */
export enum StoryStatus {
  LOBBY = 'LOBBY',
  PLAYING = 'PLAYING',
  PROCESSING = 'PROCESSING',
  REVIEW = 'REVIEW',
  FINISHED = 'FINISHED',
  ABANDONED = 'ABANDONED',
}

/** Estados en los que la partida ya no admite cambios. */
export const STORY_ENDED_STATUSES: readonly StoryStatus[] = [
  StoryStatus.FINISHED,
  StoryStatus.ABANDONED,
];

export interface StoryConfig {
  panelsCount: number;
  turnDurationSec: StoryTurnDurationSec;
  level: StoryLevel;
  language: StoryLanguage;
}

export interface StoryPlayer {
  userId: string;
  username: string;
  connected: boolean;
  /**
   * Salió de la partida después del lobby. Se queda en la lista porque el
   * orden define a quién le toca cada viñeta.
   */
  left: boolean;
  joinedAt: number;
}

/** Ficha corta: se llena durante un turno con reloj. En inglés. */
export interface CharacterSheet {
  /** "Max". */
  name: string;
  /** "dog", "girl", "robot"... */
  kind: string;
  /** Aspecto en una línea: "small brown dog with a red collar". */
  description: string;
}

/** Personaje del elenco. Inmutable una vez agregado: otras viñetas dependen de él. */
export interface StoryCharacter extends CharacterSheet {
  id: string;
  createdBy: string;
  introducedInPanel: number;
}

/** Hash `story:{gameId}`. */
export interface StoryGame {
  gameId: string;
  status: StoryStatus;
  hostId: string;
  config: StoryConfig;
  /** Orden de entrada al lobby: define los turnos. */
  players: StoryPlayer[];
  currentPanel: number | null;
  turnEndsAt: number | null;
  /** Cuándo se abandona el lobby vacío; null si hay alguien conectado. */
  abandonAt: number | null;
  /** Sube cada vez que el lobby queda vacío: invalida tareas de abandono viejas. */
  abandonSeq: number;
  createdAt: number;
}

/** Estado leído de Redis: partida + elenco (`story:{gameId}:characters`, characterId → personaje). */
export interface StorySnapshot {
  game: StoryGame;
  characters: Record<string, StoryCharacter>;
}
