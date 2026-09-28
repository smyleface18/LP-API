import { CharacterCorrection, Correction } from '@/modules/language-review/language-review.types';
import {
  CHARACTER_LIMITS,
  MAX_CHARACTERS_PER_PANEL,
  MAX_CHARACTERS_PER_STORY,
  MAX_CHARS_PER_PANEL,
  MAX_CHARS_PER_SCENE,
  MAX_DRAFTS_PER_TURN,
  MAX_NEW_CHARACTERS_PER_PANEL,
  MAX_REVIEW_ATTEMPTS,
  MIN_WORDS_PER_PANEL,
  STORY_DEFAULT_CONFIG,
  STORY_LANGUAGES,
  STORY_LEVELS,
  STORY_MAX_PLAYERS,
  STORY_MIN_PLAYERS,
  STORY_PANELS_MAX,
  STORY_PANELS_MIN,
  STORY_REACTIONS,
  STORY_TURN_DURATIONS_SEC,
} from '../story-game.config';
import { StoryPanelSummary } from './story-game.events';
import { authorStatusOf, castOf, storySoFar } from './story-turns';
import { ScoreboardEntry, scoreboardOf } from './story-review';
import {
  AuthorStatus,
  DraftInput,
  PanelDraft,
  StoryCharacter,
  StoryConfig,
  StorySnapshot,
  StoryStatus,
} from './story-game.types';

/** userId → URL firmada del avatar (`StoryUrlSigner.avatarsFor`). Sin entrada = sin avatar. */
export type AvatarUrls = Record<string, string>;

/** URLs firmadas del audio y la imagen de una viñeta. */
export interface PanelMediaUrls {
  audioUrl: string | null;
  imageUrl: string | null;
}

/** order → URLs de la media de esa viñeta (`StoryUrlSigner.mediaFor`). */
export type MediaUrls = Record<number, PanelMediaUrls>;

/** Payload de `lobbyUpdated`. */
export interface LobbyView {
  gameId: string;
  status: StoryStatus;
  hostId: string;
  config: StoryConfig;
  players: {
    userId: string;
    username: string;
    avatarUrl: string | null;
    connected: boolean;
    left: boolean;
  }[];
}

export function toLobbyView({ game }: StorySnapshot, avatars: AvatarUrls = {}): LobbyView {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    config: game.config,
    players: game.players.map(({ userId, username, connected, left }) => ({
      userId,
      username,
      avatarUrl: avatars[userId] ?? null,
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
  /** Puntajes acumulados, ordenados por promedio por viñeta. */
  scoreboard: ScoreboardEntry[];
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
  avatars: AvatarUrls = {},
  now = Date.now(),
): GameStateView {
  const { game } = snapshot;
  const panel = game.currentPanel === null ? undefined : snapshot.panels[game.currentPanel];
  const openPanel =
    game.status === StoryStatus.PLAYING && panel?.status === 'open' ? panel : undefined;

  return {
    lobby: toLobbyView(snapshot, avatars),
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
    scoreboard: scoreboardOf(game, avatars),
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

/**
 * Respuesta de `getStoryRules`: rangos de la configuración, límites del
 * borrador y reacciones permitidas, para que el cliente no los repita.
 */
export interface StoryRulesView {
  players: { min: number; max: number };
  config: {
    panelsCount: { min: number; max: number };
    turnDurationsSec: readonly number[];
    levels: readonly string[];
    languages: readonly string[];
    defaults: StoryConfig;
  };
  draft: {
    minWords: number;
    maxChars: number;
    maxSceneChars: number;
    maxReviewAttempts: number;
    maxDraftsPerTurn: number;
  };
  characters: {
    maxPerStory: number;
    maxPerPanel: number;
    maxNewPerPanel: number;
    limits: { name: number; kind: number; description: number };
  };
  reactions: readonly string[];
}

export const STORY_RULES: StoryRulesView = {
  players: { min: STORY_MIN_PLAYERS, max: STORY_MAX_PLAYERS },
  config: {
    panelsCount: { min: STORY_PANELS_MIN, max: STORY_PANELS_MAX },
    turnDurationsSec: STORY_TURN_DURATIONS_SEC,
    levels: STORY_LEVELS,
    languages: STORY_LANGUAGES,
    defaults: STORY_DEFAULT_CONFIG,
  },
  draft: {
    minWords: MIN_WORDS_PER_PANEL,
    maxChars: MAX_CHARS_PER_PANEL,
    maxSceneChars: MAX_CHARS_PER_SCENE,
    maxReviewAttempts: MAX_REVIEW_ATTEMPTS,
    maxDraftsPerTurn: MAX_DRAFTS_PER_TURN,
  },
  characters: {
    maxPerStory: MAX_CHARACTERS_PER_STORY,
    maxPerPanel: MAX_CHARACTERS_PER_PANEL,
    maxNewPerPanel: MAX_NEW_CHARACTERS_PER_PANEL,
    limits: CHARACTER_LIMITS,
  },
  reactions: STORY_REACTIONS,
};
