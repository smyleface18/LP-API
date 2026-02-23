import { ModeMatch } from './domain/match.interface';
import { Injectable } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { CacheService } from 'src/common/src/cache/cache.service';
import { Level } from 'src/db/enum/question.enum';
import { QuestionService } from 'src/modules/question/question.service';
import { CacheKeys } from 'src/common/src/cache/cache-key';
import { MatchNotFoundError } from './domain/exceptions/match-not-found.error';

@Injectable()
export class MatchService {
  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch): Promise<Match> {
    const questions = await this.questionService.getRandomQuestions(); // todo: bucar questions x level
    const match = new Match(difficulty, mode, questions);

    await this.saveMatch(match);

    return match;
  }

  async joinMatch(roomId: string, userId: string): Promise<Match> {
    const raw = await this.cache.get<string>(CacheKeys.match(roomId));

    if (!raw) {
      throw new Error('Match not found');
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const match = Match.fromPersistence(parsed);

    match.addPlayer(userId);
    await this.cache.set(CacheKeys.match(roomId), match);

    return match;
  }

  async disconnectUser(userId: string, roomId: string): Promise<Match> {
    const match = await this.cache.get<Match>(CacheKeys.match(roomId));
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    match.disconnectPlayer(userId);
    await this.cache.set(CacheKeys.match(roomId), match);

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

    return match;
  }

  private async saveMatch(match: Match): Promise<void> {
    await this.cache.set(
      CacheKeys.match(match.getRoomId()),
      JSON.stringify(match.toPersistence()),
      300,
    ); // todo: definir tll x los times de las questions
  }
}
