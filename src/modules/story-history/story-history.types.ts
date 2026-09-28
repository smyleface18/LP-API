import { Level } from '@/db/enum/question.enum';

/** Una historieta en el historial del jugador (`GET /story/history`). */
export interface StoryHistoryItem {
  storyId: string;
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

/** Página del historial. */
export interface StoryHistoryPage {
  items: StoryHistoryItem[];
  page: number;
  limit: number;
  total: number;
}
