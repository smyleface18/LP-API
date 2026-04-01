import { ModeMatch, QuestionDto } from './domain/match.interface';
import { Injectable } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { CacheService } from 'src/common/src/cache/cache.service';
import { Level } from 'src/db/enum/question.enum';
import { QuestionService } from 'src/modules/question/question.service';
import { CacheKeys } from 'src/common/src/cache/cache-key';
import { MatchNotFoundError } from './domain/exceptions/match-not-found.error';
import { UniqueNamesAdapter } from 'src/common/src/unique-names/unique-names.adapter';
import { v4 } from 'uuid';
import { User } from 'src/db/entities';

@Injectable()
export class MatchService {
  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
    private readonly uniqueNames: UniqueNamesAdapter,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch, owner: User): Promise<Match> {
    const questions = await this.questionService.getRandomQuestions(difficulty);

    let roomId = '';
    switch (mode) {
      case ModeMatch.MULTIPLAYER:
        roomId = this.uniqueNames.NamesGenerator();
        break;
      case ModeMatch.SINGLEPLAYER:
        roomId = v4();
        break;
      default:
        roomId = v4();
    }

    const match = new Match(roomId, difficulty, mode, questions, owner);

    await this.saveMatch(match);
    return match;
  }

  async joinMatch(roomId: string, userId: string): Promise<Match> {
    const match = await this.getMatch(roomId);

    match.addPlayer(userId);
    await this.saveMatch(match);

    return match;
  }

  async disconnectUser(userId: string, roomId: string): Promise<Match> {
    const match = await this.getMatch(CacheKeys.match(roomId));
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    match.disconnectPlayer(userId);
    await this.saveMatch(match);

    return match;
  }

  async finishMatch(roomId: string) {
    const match = await this.cache.get<Match>(roomId);
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    const results = match.getResults();
    await this.cache.delete(CacheKeys.match(roomId));

    return results;
  }

  async getMatch(roomId: string): Promise<Match> {
    const match = await this.cache.get<Match>(CacheKeys.match(roomId));
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    return Match.fromPersistence(match);
  }

  async nextQuestion(roomId: string): Promise<QuestionDto | null> {
    const match = await this.getMatch(roomId);
    const question = match.sendNextQuestion();
    if (!question) {
      return null;
    }

    return this.questionService.toQuestionDto(question);
  }

  async startMatch(roomId: string): Promise<QuestionDto | null> {
    const match = await this.getMatch(roomId);
    match.startMatchPreparation();

    const question = match.sendNextQuestion();
    if (!question) {
      return null;
    }

    return this.questionService.toQuestionDto(question);
  }

  private async saveMatch(match: Match): Promise<void> {
    return await this.cache.set(CacheKeys.match(match.getRoomId()), match.toPersistence(), 3600000); // todo: implement definition of ttl
  }
}
