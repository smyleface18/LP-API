import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchService } from './match/match.service';

@Injectable()
export class GameService {
  constructor(
    private readonly matchService: MatchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async start(roomId: string, userId: string) {
    await this.matchService.startMatch(roomId, userId);
    this.eventEmitter.emit('game.starting', {
      roomId,
      delay: 2000,
    });
  }

  async startQuestion(roomId: string) {
    const question = await this.matchService.nextQuestion(roomId);
    if (!question) {
      await this.finishMatch(roomId);
      return;
    }

    const match = await this.matchService.getMatch(roomId);

    this.eventEmitter.emit('game.next-question', {
      roomId,
      question,
      questionNumber: match.getcurrentQuestionIndex(),
      totalQuestions: match.getQuestions().length,
      timeLimit: question.timeLimit,
    });
  }

  async handleQuestionTimeout(roomId: string) {
    await this.matchService.finishCurrentQuestion(roomId);

    const hasNextQuestion = await this.matchService.hasNextQuestion(roomId);
    if (!hasNextQuestion) {
      await this.finishMatch(roomId);
      return;
    }

    this.eventEmitter.emit('game.question-ended', {
      roomId,
      delay: 2000,
    });
  }

  async finishMatch(roomId: string) {
    console.log(`Finalizando partida en roomId: ${roomId}`);
    const results = await this.matchService.finishMatch(roomId);
    this.eventEmitter.emit('game.finished', {
      roomId,
      results,
    });
  }
}
