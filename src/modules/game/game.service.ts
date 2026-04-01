import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchService } from './match/match.service';

@Injectable()
export class GameService {
  constructor(
    private readonly matchService: MatchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleQuestionTimeout(roomId: string) {
    //this.matchService.processAnswers(roomId);

    const question = await this.matchService.nextQuestion(roomId);
    console.log('send question', question);
    this.eventEmitter.emit('game.next-question', {
      roomId,
      question,
    });
  }
}
