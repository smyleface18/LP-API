import { Level } from '@/db/enum/question.enum';
import { StoryModerationAction, StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { ReviewManifest } from '@/modules/story-game/domain/story-review';

/** Una historieta en el historial del jugador (`GET /story/history`). */
export interface StoryHistoryItem {
  storyId: string;
  /** Título que puso la IA; null en historietas sin título. */
  title: string | null;
  /** ISO 8601. */
  finishedAt: string;
  level: Level;
  /** Viñetas confirmadas. */
  panelsCount: number;
  /** Texto de la primera viñeta, para reconocerla en la lista. */
  excerpt: string;
  /** Imagen firmada de la primera viñeta que la tenga; null si no hay. */
  coverImageUrl: string | null;
  /** Por puesto en el ranking. */
  players: { userId: string; name: string; avatarUrl: string | null }[];
  /** Puesto del jugador que pide (1 = primero). */
  myPosition: number | null;
  myScore: number;
}

/** Página del historial o del catálogo. */
export interface StoryHistoryPage {
  items: StoryHistoryItem[];
  page: number;
  limit: number;
  total: number;
}

/** Jugador de una historieta, como lo ve el admin (con datos para contactarlo). */
export interface AdminStoryParticipant {
  userId: string;
  /** Nombre cuando jugó. */
  username: string;
  /** Nombre y email actuales de la cuenta; null si la cuenta ya no existe. */
  currentUsername: string | null;
  email: string | null;
  avatarUrl: string | null;
  position: number;
  panelsWritten: number;
  totalScore: number;
  /** Salió de la partida antes de terminar. */
  left: boolean;
}

/** Quién quitó la historieta, cuándo y por qué. */
export interface AdminStoryRemoval {
  /** ISO 8601. */
  removedAt: string;
  /** null si la cuenta del admin ya no existe. */
  removedBy: { userId: string; username: string } | null;
  reason: StoryRemovalReason;
  note: string | null;
}

/** Una historieta en el panel de admin (`GET /admin/stories`). */
export interface AdminStoryItem {
  storyId: string;
  gameId: string;
  title: string | null;
  /** ISO 8601. */
  finishedAt: string;
  level: Level;
  panelsCount: number;
  excerpt: string;
  coverImageUrl: string | null;
  visibility: StoryVisibility;
  /** Por puesto en el ranking. */
  participants: AdminStoryParticipant[];
  /** null si está publicada. */
  removal: AdminStoryRemoval | null;
}

/** Una acción del historial de moderación (quitar o restaurar). */
export interface AdminStoryModerationEntry {
  action: StoryModerationAction;
  /** ISO 8601. */
  at: string;
  /** null si la cuenta del admin ya no existe. */
  admin: { userId: string; username: string } | null;
  /** Solo al quitar. */
  reason: StoryRemovalReason | null;
  note: string | null;
}

/**
 * Detalle para el admin: el resumen, la historieta completa (manifiesto del
 * review) y el historial de moderación, de la acción más reciente a la más vieja.
 */
export interface AdminStoryDetail extends AdminStoryItem {
  manifest: ReviewManifest;
  moderationHistory: AdminStoryModerationEntry[];
}

export interface AdminStoryPage {
  items: AdminStoryItem[];
  page: number;
  limit: number;
  total: number;
}
