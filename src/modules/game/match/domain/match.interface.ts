import { CategoryQuestion } from 'src/db/entities';
import { S3Object } from 'src/db/entities/model.core';
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

export type OptionDto =
  | {
      id: string;
      text: string;
      media?: undefined;
    }
  | {
      id: string;
      text?: undefined;
      media: S3Object;
    }
  | {
      id: string;
      text: string;
      media: S3Object;
    };

export interface QuestionDto {
  id: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  questionText: string;
  category: CategoryQuestion;
  options: OptionDto[];
  categoryId: string;
  timeLimit: number;
  media?: S3Object;
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
