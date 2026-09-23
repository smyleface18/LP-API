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
  /** Segundos desde que se envió la pregunta. */
  timeTaken: number;
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

export interface MatchSnapshot {
  roomId: string;
  difficulty: Level;
  status: MatchStatus;
  currentQuestionIndex: number;
  players: [string, PlayerInfo][];
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
