import { StoryLanguage, StoryLevel, StoryTurnDurationSec } from '../story-game.config';

/**
 * Estados de la partida. Solo el servidor los cambia:
 *   LOBBY → CHARACTERS → PLAYING → PROCESSING → REVIEW → FINISHED
 *   cualquiera → ABANDONED (no quedan jugadores conectados)
 */
export enum StoryStatus {
  LOBBY = 'LOBBY',
  CHARACTERS = 'CHARACTERS',
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
   * Salió de la partida después del lobby/personajes. Se queda en la lista
   * porque el orden define a quién le toca cada viñeta.
   */
  left: boolean;
  joinedAt: number;
}

export interface CharacterSheet {
  name: string;
  type: string;
  trait: string;
  clothing: string;
  detail: string;
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
  createdAt: number;
}

/** Estado leído de Redis: partida + fichas (`story:{gameId}:characters`, userId → ficha). */
export interface StorySnapshot {
  game: StoryGame;
  characters: Record<string, CharacterSheet>;
}
