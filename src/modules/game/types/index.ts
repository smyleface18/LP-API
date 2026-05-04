import { Socket } from 'socket.io';
import { ModeMatch } from '../match/domain/match.interface';
import { Level } from 'src/db/enum/question.enum';
import { QuestionOption } from 'src/db/entities';

export interface ConnectionGameSocket extends Socket {
  data: {
    userId: string;
    role: string[];
    roomId?: string;
  };
}

export interface CreateGameDto {
  level: Level;
  modeMatch: ModeMatch;
}

export interface JoinGameDto {
  roomId: string;
}

export interface TimeoutDto {
  roomId: string;
  timeLimit: number;
}

export interface AnswerQuestionDto {
  questionId: string;
  answerId: string;
}

export interface QuestionResultDto {
  isCorrect: boolean;
  correctAnswer: QuestionOption[];
  pointsEarned: number;
}
