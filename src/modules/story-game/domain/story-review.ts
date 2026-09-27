import { Correction } from '@/modules/language-review/language-review.types';
import { StoryReaction } from '../story-game.config';
import { castOf, closedPanels } from './story-turns';
import { PanelScore, StoryCharacter, StoryGame, StorySnapshot } from './story-game.types';

/** Puntaje acumulado de un jugador: `scoreboard` de gameState y `ranking` del manifiesto. */
export interface ScoreboardEntry {
  userId: string;
  name: string;
  panelsWritten: number;
  totalScore: number;
  /** totalScore / panelsWritten, con un decimal; 0 si no escribió ninguna. */
  averageScore: number;
}

/** Palabra narrada en el audio (Polly, Fase 4b): ms desde el inicio y offsets en `finalText`. */
export interface SpeechMark {
  time: number;
  start: number;
  end: number;
  value: string;
}

/** `none` = esta versión no genera media (Fase 4a). */
export type PanelMediaStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface ReviewPanel {
  order: number;
  author: { id: string; name: string };
  /** Último texto escrito por el jugador; vacío si el turno venció sin borradores. */
  originalText: string;
  /** Texto que se narra: el corregido. */
  finalText: string;
  scene: string;
  characterIds: string[];
  /** Correcciones de la última revisión (las que cuentan para el puntaje). */
  corrections: Correction[];
  score: PanelScore;
  /** userId → emoji. */
  reactions: Record<string, StoryReaction>;
  audioUrl: string | null;
  speechMarks: SpeechMark[] | null;
  imageUrl: string | null;
  mediaStatus: PanelMediaStatus;
}

/** Manifiesto del review final: `storyReviewReady` y `getReviewManifest`. */
export interface ReviewManifest {
  /** Hasta que exista la persistencia (Fase 4c) es el gameId. */
  storyId: string;
  gameId: string;
  characters: StoryCharacter[];
  ranking: ScoreboardEntry[];
  panels: ReviewPanel[];
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * Puntajes de todos los jugadores, ordenados por promedio por viñeta (desempata
 * el total y después el orden de entrada). Los que no escribieron ninguna
 * viñeta van al final.
 */
export function scoreboardOf(game: StoryGame): ScoreboardEntry[] {
  return game.players
    .map((player) => ({
      userId: player.userId,
      name: player.username,
      panelsWritten: player.panelsWritten,
      totalScore: player.totalScore,
      averageScore:
        player.panelsWritten > 0 ? oneDecimal(player.totalScore / player.panelsWritten) : 0,
    }))
    .sort(
      (a, b) =>
        Number(b.panelsWritten > 0) - Number(a.panelsWritten > 0) ||
        b.averageScore - a.averageScore ||
        b.totalScore - a.totalScore,
    );
}

/** Manifiesto a partir del estado en Redis. Sin media todavía: todo `none`. */
export function toReviewManifest(snapshot: StorySnapshot): ReviewManifest {
  const { game } = snapshot;
  const nameOf = (userId: string) =>
    game.players.find((player) => player.userId === userId)?.username ?? '';

  return {
    storyId: game.gameId,
    gameId: game.gameId,
    characters: castOf(snapshot),
    ranking: scoreboardOf(game),
    panels: closedPanels(snapshot).map((panel) => ({
      order: panel.order,
      author: { id: panel.authorId, name: nameOf(panel.authorId) },
      originalText: panel.originalText ?? '',
      finalText: panel.finalText ?? '',
      scene: panel.scene ?? '',
      characterIds: panel.characterIds,
      corrections: panel.drafts.at(-1)?.review?.corrections ?? [],
      score: panel.score!,
      reactions: panel.reactions ?? {},
      audioUrl: null,
      speechMarks: null,
      imageUrl: null,
      mediaStatus: 'none',
    })),
  };
}
