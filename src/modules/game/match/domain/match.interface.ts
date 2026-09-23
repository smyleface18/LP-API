import { CategoryQuestion, MediaAsset } from '@/db/entities';
import { ContentType, Level } from '@/db/enum/question.enum';

export interface PlayerInfo {
  userId: string;
  username: string;
  level: Level;
  matchScore: number;
  totalScore: number;
  isConnected: boolean;
  isOwner: boolean;
  avatar?: string;
}

export interface RecordedAnswer {
  questionId: string;
  userId: string;
  optionId: string;
  isCorrect: boolean;
  /** Segundos desde que se mostró la pregunta (startsAt). */
  timeTaken: number;
  points: number;
}

export enum ModeMatch {
  SINGLEPLAYER = 'SINGLEPLAYER',
  MULTIPLAYER = 'MULTIPLAYER',
}

export enum MatchStatus {
  WAITING = 'WAITING',
  QUESTION_ACTIVE = 'QUESTION_ACTIVE',
  PROCESSING = 'PROCESSING',
  BETWEEN_QUESTIONS = 'BETWEEN_QUESTIONS',
  FINISHED = 'FINISHED',
  STARTING = 'STARTING',
  PREPARING = 'PREPARING',
}

/**
 * Estado completo de la partida para un jugador que se (re)conecta: con esto
 * el cliente reconstruye la pantalla sin haber recibido los eventos previos.
 * Los instantes están en hora del servidor (epoch ms).
 */
export interface GameStateSnapshot {
  roomId: string;
  level: Level;
  modeMatch: ModeMatch;
  status: MatchStatus;
  players: PlayerInfo[];
  questionNumber: number;
  totalQuestions: number;
  /** Solo si hay una pregunta activa. */
  question: QuestionDto | null;
  startsAt: number | null;
  endsAt: number | null;
  /** Opción que este jugador ya eligió en la pregunta activa, si respondió. */
  answeredOptionId: string | null;
  nextQuestionAt: number | null;
}

export interface OptionDto {
  id: string;
  contentType: ContentType;
  text?: string;
  media?: MediaAsset;
}

export interface QuestionDto {
  id: string;
  contentType: ContentType;
  text?: string;
  media?: MediaAsset;
  category: CategoryQuestion;
  options: OptionDto[];
  categoryId: string;
  timeLimit: number;
}

export interface MatchDto {
  roomId: string;
  difficulty: Level;
  mode: ModeMatch;
  status: MatchStatus;
  currentQuestionIndex: number;
  players: PlayerInfo[];
  questions: QuestionDto[];
}
