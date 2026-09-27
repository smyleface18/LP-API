import { CharacterCorrection, Correction } from '@/modules/language-review/language-review.types';
import { MAX_REVIEW_ATTEMPTS } from '../story-game.config';
import { StoryPanelSummary } from './story-game.events';
import { authorStatusOf, castOf, storySoFar } from './story-turns';
import {
  AuthorStatus,
  DraftInput,
  PanelDraft,
  StoryCharacter,
  StoryConfig,
  StorySnapshot,
  StoryStatus,
} from './story-game.types';

/** Payload de `lobbyUpdated`. */
export interface LobbyView {
  gameId: string;
  status: StoryStatus;
  hostId: string;
  config: StoryConfig;
  players: {
    userId: string;
    username: string;
    connected: boolean;
    left: boolean;
  }[];
}

export function toLobbyView({ game }: StorySnapshot): LobbyView {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    config: game.config,
    players: game.players.map(({ userId, username, connected, left }) => ({
      userId,
      username,
      connected,
      left,
    })),
  };
}

/**
 * Payload de `panelReviewResult` (solo al autor). Nunca incluye el texto
 * corregido: el jugador corrige solo, con las explicaciones.
 */
export interface PanelReviewResultView {
  panelOrder: number;
  /** El borrador tiene contenido inapropiado: se rechazó sin consumir intento. */
  flagged: boolean;
  /** false si la IA no estaba disponible: el borrador se guardó sin revisión y sin consumir intento. */
  reviewAvailable: boolean;
  corrections: Correction[];
  characterCorrections: CharacterCorrection[];
  attemptsLeft: number;
  message?: string;
}

/** Borrador propio, tal como lo ve su autor (sin `correctedText`). */
export interface OwnDraftView extends DraftInput {
  reviewAvailable: boolean;
  corrections: Correction[];
  characterCorrections: CharacterCorrection[];
}

export interface TurnView {
  panelOrder: number;
  authorId: string;
  endsAt: number;
  authorStatus: AuthorStatus;
}

/** Respuesta de `getGameState` y evento `gameState` al reconectarse. */
export interface GameStateView {
  lobby: LobbyView;
  turn: TurnView | null;
  storySoFar: StoryPanelSummary[];
  cast: StoryCharacter[];
  /** Solo para el autor del turno en curso. */
  myTurn: {
    attempts: number;
    attemptsLeft: number;
    reviewing: boolean;
    drafts: OwnDraftView[];
  } | null;
}

export function toOwnDraftView(draft: PanelDraft): OwnDraftView {
  return {
    text: draft.text,
    scene: draft.scene,
    characterIds: draft.characterIds,
    newCharacters: draft.newCharacters,
    reviewAvailable: draft.review !== null,
    corrections: draft.review?.corrections ?? [],
    characterCorrections: draft.review?.characterCorrections ?? [],
  };
}

export function toGameStateView(
  snapshot: StorySnapshot,
  userId: string,
  now = Date.now(),
): GameStateView {
  const { game } = snapshot;
  const panel = game.currentPanel === null ? undefined : snapshot.panels[game.currentPanel];
  const openPanel =
    game.status === StoryStatus.PLAYING && panel?.status === 'open' ? panel : undefined;

  return {
    lobby: toLobbyView(snapshot),
    turn:
      openPanel && game.turnEndsAt !== null
        ? {
            panelOrder: openPanel.order,
            authorId: openPanel.authorId,
            endsAt: game.turnEndsAt,
            authorStatus: authorStatusOf(openPanel, now),
          }
        : null,
    storySoFar: storySoFar(snapshot),
    cast: castOf(snapshot),
    myTurn:
      openPanel && openPanel.authorId === userId
        ? {
            attempts: openPanel.attempts,
            attemptsLeft: MAX_REVIEW_ATTEMPTS - openPanel.attempts,
            reviewing: openPanel.reviewing !== null,
            drafts: openPanel.drafts.map(toOwnDraftView),
          }
        : null,
  };
}
