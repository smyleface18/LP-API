import {
  StoryLanguage,
  StoryLevel,
  StoryReaction,
  StoryTurnDurationSec,
} from '../story-game.config';
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

/** Estados en los que se puede reaccionar a las viñetas confirmadas. */
export const STORY_REACTABLE_STATUSES: readonly StoryStatus[] = [
  StoryStatus.PLAYING,
  StoryStatus.PROCESSING,
  StoryStatus.REVIEW,
  StoryStatus.FINISHED,
];

/** Estados en los que la partida ya no cambia (salvo las reacciones en FINISHED). */
export const STORY_ENDED_STATUSES: readonly StoryStatus[] = [
  StoryStatus.FINISHED,
  StoryStatus.ABANDONED,
];

export interface StoryConfig {
  panelsCount: number;
  turnDurationSec: StoryTurnDurationSec;
  level: StoryLevel;
  language: StoryLanguage;
  /**
   * Los demás jugadores ven cada borrador revisado del autor, con sus
   * correcciones (`panelDraftReviewed`), mientras la viñeta está abierta.
   */
  shareDrafts: boolean;
}

export interface StoryPlayer {
  userId: string;
  username: string;
  /**
   * Key en S3 del avatar (no la URL: las URLs firmadas vencen). Se firma al
   * enviar las vistas (`StoryUrlSigner`). Partidas viejas en Redis no la tienen.
   */
  avatarKey?: string | null;
  connected: boolean;
  /**
   * Salió de la partida después del lobby. Se queda en la lista porque el
   * orden define a quién le toca cada viñeta.
   */
  left: boolean;
  joinedAt: number;
  /** Suma de los puntajes de sus viñetas. */
  totalScore: number;
  /** Viñetas que le tocaron y se cerraron (incluidas las que vencieron sin texto). */
  panelsWritten: number;
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
  /** Fin del turno que ven los clientes. */
  turnEndsAt: number | null;
  /**
   * Cuándo corre `close-turn`. Igual a `turnEndsAt`, salvo que el turno haya
   * vencido con una revisión en curso (entonces es el respaldo).
   */
  turnCloseAt: number | null;
  /** Cuándo se abandona la partida sin nadie conectado; null si hay alguien conectado. */
  abandonAt: number | null;
  /** Sube cada vez que la partida queda vacía: invalida tareas de abandono viejas. */
  abandonSeq: number;
  createdAt: number;
  /**
   * Id de la historieta (el de Postgres, Fase 4c). Se asigna al empezar la
   * generación de la media; null antes.
   */
  storyId: string | null;
  /**
   * Plazo de la generación de media: al vencer, las viñetas que sigan
   * `pending` pasan a `failed` y la partida avanza. null si no hay nada pendiente.
   */
  mediaDeadlineAt: number | null;
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

/** Puntaje de una viñeta (ver calculatePanelScore). */
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
  /** Envíos de borrador en este turno (tope MAX_DRAFTS_PER_TURN), consuman o no intento. */
  submissions: number;
  /** Revisión en curso: mientras exista se rechaza otro borrador. */
  reviewing: { attemptId: string; startedAt: number } | null;
  /**
   * El turno venció con una revisión en curso: al guardarse el resultado se
   * cierra con ese borrador (`confirmedBy: 'timeout'`).
   */
  closeWhenReviewed: boolean;
  /** Último texto escrito por el jugador. */
  originalText: string | null;
  /** Texto que se narra (siempre el corregido). */
  finalText: string | null;
  scene: string | null;
  /** Al confirmar: existentes + nuevos ya creados. */
  characterIds: string[];
  /** Se calcula al cerrarse; null mientras está abierta. */
  score: PanelScore | null;
  confirmedBy: PanelConfirmedBy | null;
  /** Reacciones a la viñeta confirmada: userId → emoji (una por jugador). */
  reactions: Record<string, StoryReaction>;
  /** Audio e imagen (Fase 4b). Sin definir hasta que empieza la generación. */
  media?: PanelMedia;
}

/**
 * - `none`: no se genera (la viñeta venció sin texto).
 * - `pending`: en la cola de generación.
 * - `ready`: tiene audio (la imagen es opcional: puede no estar configurada o fallar sola).
 * - `failed`: no se pudo generar el audio.
 */
export type PanelMediaStatus = 'none' | 'pending' | 'ready' | 'failed';

/** Palabra narrada en el audio: ms desde el inicio y offsets (en caracteres) en `finalText`. */
export interface SpeechMark {
  time: number;
  start: number;
  end: number;
  value: string;
}

/** Media de una viñeta. Se guardan las keys de S3; las URLs se firman al enviar. */
export interface PanelMedia {
  status: PanelMediaStatus;
  audioKey: string | null;
  imageKey: string | null;
  /** Estado de la imagen. Partidas anteriores no lo tienen (ver `imageStatusOf`). */
  imageStatus?: PanelImageStatus;
  speechMarks: SpeechMark[] | null;
}

/**
 * Imagen de una viñeta (independiente del audio: sin imagen, la viñeta se lee igual).
 * - `none`: no se dibuja (sin proveedor de imágenes, o la viñeta venció sin texto).
 * - `pending`: en la cola de generación.
 * - `ready`: dibujada y subida a S3.
 * - `failed`: el proveedor falló en todos los intentos, o venció el plazo.
 */
export type PanelImageStatus = 'none' | 'pending' | 'ready' | 'failed';

/** `imageStatus` de una media, derivado de `imageKey` si es de una partida anterior. */
export function imageStatusOf(media: PanelMedia | undefined): PanelImageStatus {
  if (!media) return 'none';
  return media.imageStatus ?? (media.imageKey ? 'ready' : 'none');
}

/** Qué está haciendo el autor del turno en curso (`authorStatus`). */
export type AuthorStatus = 'writing' | 'reviewing' | 'correcting';

/** Estado leído de Redis: partida, elenco (characterId → personaje) y viñetas (order → viñeta). */
export interface StorySnapshot {
  game: StoryGame;
  characters: Record<string, StoryCharacter>;
  panels: Record<number, PanelState>;
}
