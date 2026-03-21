import { CategoryQuestion } from 'src/db/entities';
import { S3Object } from 'src/db/entities/model.core';
import { Level } from 'src/db/enum/question.enum';

export interface PlayerState {
  userId: string;
  score: number;
  isConnected: boolean;
}

export enum ModeMatch {
  SINGLEPLAYER = 'SINGLEPLAYER',
  MULTIPLAYER = 'MULTIPLAYER',
}

export enum MatchStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  FINISHED = 'finished',
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
