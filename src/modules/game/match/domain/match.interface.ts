import { CategoryQuestion } from 'src/db/entities';
import { ContentObject } from 'src/db/entities/model.core';
import { Level } from 'src/db/enum/question.enum';

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
  content: ContentObject;
}

export interface QuestionDto {
  id: string;
  content: ContentObject;
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
