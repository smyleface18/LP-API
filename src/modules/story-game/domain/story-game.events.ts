import { CharacterCorrection, Correction } from '@/modules/language-review/language-review.types';
import { StoryReaction } from '../story-game.config';
import {
  AuthorStatus,
  CharacterSheet,
  PanelConfirmedBy,
  PanelScore,
  StoryCharacter,
  StorySnapshot,
} from './story-game.types';

/**
 * Eventos internos que emite StoryGameService al terminar una operación (ya
 * guardada). El gateway los difunde a la sala; así funcionan igual cuando el
 * cambio lo dispara un timer en cualquier instancia.
 */
export const STORY_EVENTS = {
  /** Cambió el estado general (ej. PLAYING, PROCESSING, ABANDONED): `lobbyUpdated`. */
  stateChanged: 'story.state-changed',
  turnStarted: 'story.turn-started',
  panelConfirmed: 'story.panel-confirmed',
  /** El autor empezó a escribir, espera la revisión o corrige: `authorStatus` a la sala. */
  authorStatus: 'story.author-status',
  /** Borrador revisado, con `shareDrafts`: `panelDraftReviewed` a la sala menos el autor. */
  draftReviewed: 'story.draft-reviewed',
  panelReaction: 'story.panel-reaction',
  /** Entró a PROCESSING: punto de enganche de la generación de media (Fase 4b). */
  processingStarted: 'story.processing-started',
  /** Entró a REVIEW: `storyReviewReady` con el manifiesto. */
  reviewReady: 'story.review-ready',
} as const;

/** Resumen de una viñeta confirmada, tal como la ven todos durante la partida. */
export interface StoryPanelSummary {
  order: number;
  authorId: string;
  finalText: string;
  scene: string;
  characterIds: string[];
  /** userId → emoji. */
  reactions: Record<string, StoryReaction>;
}

export interface StoryStateChangedEvent {
  snapshot: StorySnapshot;
}

export interface TurnStartedEvent {
  gameId: string;
  panelOrder: number;
  authorId: string;
  endsAt: number;
  storySoFar: StoryPanelSummary[];
  cast: StoryCharacter[];
}

export interface PanelConfirmedEvent {
  gameId: string;
  order: number;
  authorId: string;
  finalText: string;
  scene: string;
  characterIds: string[];
  /** Personajes que entraron al elenco con esta viñeta. */
  newCharacters: StoryCharacter[];
  score: PanelScore;
  confirmedBy: PanelConfirmedBy;
}

export interface AuthorStatusEvent {
  gameId: string;
  order: number;
  status: AuthorStatus;
}

/**
 * Borrador revisado, tal como lo ven los demás jugadores. Nunca incluye el
 * texto corregido, y un borrador `flagged` no se comparte.
 */
export interface DraftReviewedEvent {
  gameId: string;
  order: number;
  authorId: string;
  text: string;
  scene: string;
  characterIds: string[];
  newCharacters: CharacterSheet[];
  /** false si la IA no estaba disponible (sin correcciones). */
  reviewAvailable: boolean;
  corrections: Correction[];
  characterCorrections: CharacterCorrection[];
}

/** `emoji: null` = el jugador quitó su reacción. */
export interface PanelReactionEvent {
  gameId: string;
  order: number;
  userId: string;
  emoji: StoryReaction | null;
}

export interface ProcessingStartedEvent {
  gameId: string;
}

/**
 * Entró a REVIEW. Lleva el estado y no el manifiesto: el gateway lo arma con
 * los avatares firmados al momento de enviarlo.
 */
export interface ReviewReadyEvent {
  gameId: string;
  snapshot: StorySnapshot;
}

export type StoryOutboxItem =
  | { event: typeof STORY_EVENTS.stateChanged; payload: StoryStateChangedEvent }
  | { event: typeof STORY_EVENTS.turnStarted; payload: TurnStartedEvent }
  | { event: typeof STORY_EVENTS.panelConfirmed; payload: PanelConfirmedEvent }
  | { event: typeof STORY_EVENTS.authorStatus; payload: AuthorStatusEvent }
  | { event: typeof STORY_EVENTS.draftReviewed; payload: DraftReviewedEvent }
  | { event: typeof STORY_EVENTS.panelReaction; payload: PanelReactionEvent }
  | { event: typeof STORY_EVENTS.processingStarted; payload: ProcessingStartedEvent }
  | { event: typeof STORY_EVENTS.reviewReady; payload: ReviewReadyEvent };
