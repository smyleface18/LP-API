import { StoryLanguage, StoryLevel, StoryTurnDurationSec } from '../story-game.config';
import { LanguageReview } from '@/modules/language-review/language-review.types';

/**
 * Estados de la partida. Solo el servidor los cambia:
 *   LOBBY → PLAYING → PROCESSING → REVIEW → FINISHED
 *   LOBBY/PLAYING → ABANDONED (nadie conectado durante IDLE_ABANDON_DELAY_MS)
 * PROCESSING y REVIEW nunca se abandonan: la historieta se termina de generar
 * y se guarda aunque todos se hayan ido.
 */
export enum StoryStatus {
  LOBBY = 'LOBBY',
  PLAYING = 'PLAYING',
  PROCESSING = 'PROCESSING',
  REVIEW = 'REVIEW',
  FINISHED = 'FINISHED',
  ABANDONED = 'ABANDONED',
}

/** Estados en los que una partida sin nadie conectado puede abandonarse. */
export const STORY_ABANDONABLE_STATUSES: readonly StoryStatus[] = [
  StoryStatus.LOBBY,
  StoryStatus.PLAYING,
];

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
  /** Cuándo se abandona la partida sin nadie conectado; null si hay alguien conectado. */
  abandonAt: number | null;
  /** Sube cada vez que la partida queda vacía: invalida tareas de abandono viejas. */
  abandonSeq: number;
  createdAt: number;
}

/** Lo que el autor envía en `submitPanelDraft`. */
export interface DraftInput {
  text: string;
  scene: string;
  /** Personajes del elenco que aparecen en la viñeta. */
  characterIds: string[];
  /** Personajes nuevos propuestos: entran al elenco recién al confirmar. */
  newCharacters: CharacterSheet[];
}

/** Borrador ya revisado. `review: null` = la IA no estaba disponible. */
export interface PanelDraft extends DraftInput {
  review: LanguageReview | null;
}

/** Puntaje de una viñeta (se calcula en la Fase 3; en la Fase 2 solo el caso sin texto). */
export interface PanelScore {
  accuracy: number;
  firstTryBonus: number;
  selfCorrectionBonus: number;
  timeoutPenalty: boolean;
  total: number;
}

export type PanelConfirmedBy = 'player' | 'timeout';

/** Hash `story:{gameId}:panels`, order → viñeta. */
export interface PanelState {
  order: number;
  authorId: string;
  /** El cierre (confirmar o timeout) pasa de 'open' a 'closed' una sola vez. */
  status: 'open' | 'closed';
  /** Revisiones exitosas usadas (máx. MAX_REVIEW_ATTEMPTS). */
  attempts: number;
  drafts: PanelDraft[];
  /** Revisión en curso: mientras exista se rechaza otro borrador. */
  reviewing: { attemptId: string; startedAt: number } | null;
  /** Último texto escrito por el jugador. */
  originalText: string | null;
  /** Texto que se narra (siempre el corregido). */
  finalText: string | null;
  scene: string | null;
  /** Al confirmar: existentes + nuevos ya creados. */
  characterIds: string[];
  score: PanelScore | null;
  confirmedBy: PanelConfirmedBy | null;
}

/** Estado leído de Redis: partida, elenco (characterId → personaje) y viñetas (order → viñeta). */
export interface StorySnapshot {
  game: StoryGame;
  characters: Record<string, StoryCharacter>;
  panels: Record<number, PanelState>;
}
