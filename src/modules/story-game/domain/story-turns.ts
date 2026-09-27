import { HttpStatus } from '@nestjs/common';
import {
  MAX_CHARACTERS_PER_PANEL,
  MAX_CHARACTERS_PER_STORY,
  MAX_NEW_CHARACTERS_PER_PANEL,
  MIN_WORDS_PER_PANEL,
  OUT_OF_TIME_TEXT,
} from '../story-game.config';
import { StoryError } from './story-game.errors';
import { PanelConfirmedEvent, StoryPanelSummary } from './story-game.events';
import {
  DraftInput,
  PanelConfirmedBy,
  PanelScore,
  PanelState,
  StoryCharacter,
  StoryGame,
  StorySnapshot,
} from './story-game.types';

/**
 * Reglas de los turnos, como funciones puras sobre el estado leído de Redis.
 * Modifican el snapshot recibido; StoryGameService decide qué se guarda.
 */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Jugadores que no abandonaron (los desconectados cuentan: pueden volver). */
export function remainingPlayers(game: StoryGame) {
  return game.players.filter((player) => !player.left);
}

/**
 * Siguiente autor después de la posición `fromIndex`, en orden de entrada y
 * circular: el primero conectado que no abandonó; si no hay, el primero que no
 * abandonó (puede reconectarse).
 */
export function nextAuthorAfter(game: StoryGame, fromIndex: number): string {
  const count = game.players.length;
  const inOrder = Array.from({ length: count }, (_, step) => {
    return game.players[(fromIndex + 1 + step) % count];
  });
  const author =
    inOrder.find((player) => !player.left && player.connected) ??
    inOrder.find((player) => !player.left);
  if (!author) throw new Error(`story ${game.gameId} has no players left to write`);
  return author.userId;
}

/** La viñeta `order` es de `players[order % n]`; si ese jugador abandonó, del siguiente. */
export function authorFor(game: StoryGame, order: number): string {
  const index = order % game.players.length;
  const player = game.players[index];
  return player.left ? nextAuthorAfter(game, index) : player.userId;
}

function freshPanel(order: number, authorId: string): PanelState {
  return {
    order,
    authorId,
    status: 'open',
    attempts: 0,
    submissions: 0,
    drafts: [],
    reviewing: null,
    closeWhenReviewed: false,
    originalText: null,
    finalText: null,
    scene: null,
    characterIds: [],
    score: null,
    confirmedBy: null,
  };
}

/** Abre (o reabre para otro autor) el turno de la viñeta `order`. */
export function openTurn(
  snapshot: StorySnapshot,
  order: number,
  authorId: string,
  now: number,
): PanelState {
  const { game } = snapshot;
  const panel = freshPanel(order, authorId);
  snapshot.panels[order] = panel;
  game.currentPanel = order;
  game.turnEndsAt = now + game.config.turnDurationSec * 1000;
  game.turnCloseAt = game.turnEndsAt;
  return panel;
}

export function closedPanels(snapshot: StorySnapshot): PanelState[] {
  return Object.values(snapshot.panels)
    .filter((panel) => panel.status === 'closed')
    .sort((a, b) => a.order - b.order);
}

export function storySoFar(snapshot: StorySnapshot): StoryPanelSummary[] {
  return closedPanels(snapshot).map((panel) => ({
    order: panel.order,
    authorId: panel.authorId,
    finalText: panel.finalText ?? '',
    scene: panel.scene ?? '',
    characterIds: panel.characterIds,
  }));
}

/** Elenco en el orden en que se fue creando. */
export function castOf(snapshot: StorySnapshot): StoryCharacter[] {
  return Object.values(snapshot.characters).sort(
    (a, b) => a.introducedInPanel - b.introducedInPanel || a.id.localeCompare(b.id),
  );
}

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * Reglas del borrador que dependen del estado (el DTO ya validó forma y
 * largos): cantidad de palabras y personajes.
 */
export function validateDraft(snapshot: StorySnapshot, draft: DraftInput): void {
  const invalid = (message: string) =>
    new StoryError('INVALID_DRAFT', message, HttpStatus.UNPROCESSABLE_ENTITY);

  if (countWords(draft.text) < MIN_WORDS_PER_PANEL) {
    throw invalid(`The text needs at least ${MIN_WORDS_PER_PANEL} words`);
  }

  const unknown = draft.characterIds.filter((id) => !snapshot.characters[id]);
  if (unknown.length > 0) {
    throw new StoryError(
      'UNKNOWN_CHARACTER',
      `Unknown character: ${unknown.join(', ')}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (new Set(draft.characterIds).size !== draft.characterIds.length) {
    throw invalid('A character is marked twice');
  }

  if (draft.newCharacters.length > MAX_NEW_CHARACTERS_PER_PANEL) {
    throw invalid(`At most ${MAX_NEW_CHARACTERS_PER_PANEL} new characters per panel`);
  }
  if (draft.characterIds.length + draft.newCharacters.length > MAX_CHARACTERS_PER_PANEL) {
    throw invalid(`At most ${MAX_CHARACTERS_PER_PANEL} characters per panel`);
  }
  const castSize = Object.keys(snapshot.characters).length;
  if (castSize + draft.newCharacters.length > MAX_CHARACTERS_PER_STORY) {
    throw new StoryError(
      'TOO_MANY_CHARACTERS',
      `The story can have at most ${MAX_CHARACTERS_PER_STORY} characters`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  const taken = new Set(Object.values(snapshot.characters).map((c) => normalizeName(c.name)));
  for (const character of draft.newCharacters) {
    const name = normalizeName(character.name);
    if (taken.has(name)) {
      throw new StoryError(
        'DUPLICATE_CHARACTER_NAME',
        `There is already a character called ${character.name.trim()}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    taken.add(name);
  }
}

function zeroScore(): PanelScore {
  return {
    accuracy: 0,
    firstTryBonus: 0,
    selfCorrectionBonus: 0,
    timeoutPenalty: true,
    total: 0,
  };
}

/**
 * Cierra la viñeta abierta con su último borrador (o con OUT_OF_TIME_TEXT si
 * venció sin ninguno) y agrega al elenco los personajes nuevos de ese
 * borrador. Devuelve el evento `panelConfirmed`.
 */
export function confirmPanel(
  snapshot: StorySnapshot,
  panel: PanelState,
  confirmedBy: PanelConfirmedBy,
): PanelConfirmedEvent {
  const draft = panel.drafts.at(-1);
  const newCharacters: StoryCharacter[] = [];

  if (draft) {
    draft.newCharacters.forEach((sheet, index) => {
      const character: StoryCharacter = {
        id: `ch-${panel.order}-${index}`,
        name: sheet.name,
        kind: sheet.kind,
        description: sheet.description,
        createdBy: panel.authorId,
        introducedInPanel: panel.order,
      };
      snapshot.characters[character.id] = character;
      newCharacters.push(character);
    });

    panel.originalText = draft.text;
    panel.finalText = draft.review?.correctedText ?? draft.text;
    panel.scene = draft.scene;
    panel.characterIds = [...draft.characterIds, ...newCharacters.map((c) => c.id)];
    // El puntaje se calcula en la Fase 3.
    panel.score = null;
  } else {
    panel.originalText = null;
    panel.finalText = OUT_OF_TIME_TEXT;
    panel.scene = '';
    panel.characterIds = [];
    panel.score = zeroScore();
  }

  panel.status = 'closed';
  panel.reviewing = null;
  panel.closeWhenReviewed = false;
  panel.confirmedBy = confirmedBy;

  return {
    gameId: snapshot.game.gameId,
    order: panel.order,
    authorId: panel.authorId,
    finalText: panel.finalText,
    scene: panel.scene ?? '',
    characterIds: panel.characterIds,
    newCharacters,
    score: panel.score,
    confirmedBy,
  };
}
