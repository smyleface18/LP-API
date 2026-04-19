import { CategoryQuestion } from 'src/db/entities';
import { S3Object } from 'src/db/entities/model.core';
import { Level } from 'src/db/enum/question.enum';

export interface PlayerState {
  userId: string;
  username: string;
  avatar?: string;
  level: Level;
  score: number;
  isConnected: boolean;
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
  players: [string, PlayerState][];
}

export interface OptionDto {
  id: string;
  text?: string;
  media?: S3Object;
}

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
