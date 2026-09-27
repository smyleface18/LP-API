import { PanelConfirmedBy, PanelScore, StoryCharacter, StorySnapshot } from './story-game.types';

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
  /** Entró a PROCESSING: punto de enganche de la generación de media (Fase 4). */
  processingStarted: 'story.processing-started',
} as const;

/** Resumen de una viñeta confirmada, tal como la ven todos durante la partida. */
export interface StoryPanelSummary {
  order: number;
  authorId: string;
  finalText: string;
  scene: string;
  characterIds: string[];
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

export interface ProcessingStartedEvent {
  gameId: string;
}

export type StoryOutboxItem =
  | { event: typeof STORY_EVENTS.stateChanged; payload: StoryStateChangedEvent }
  | { event: typeof STORY_EVENTS.turnStarted; payload: TurnStartedEvent }
  | { event: typeof STORY_EVENTS.panelConfirmed; payload: PanelConfirmedEvent }
  | { event: typeof STORY_EVENTS.processingStarted; payload: ProcessingStartedEvent };
