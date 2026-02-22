import { ModeMatch } from './domain/match.interface';
import { Injectable } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { CacheService } from 'src/common/src/cache/cache.service';
import { Level } from 'src/db/enum/question.enum';
import { QuestionService } from 'src/modules/question/question.service';

@Injectable()
export class MatchService {
  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch): Promise<void> {
    const questions = await this.questionService.getRandomQuestions(); // todo: bucar questions x level
    const match = new Match(difficulty, mode, questions);

    await this.saveMatch(match);
  }

  async joinMatch(roomId: string, userId: string): Promise<Match> {
    const raw = await this.cache.get<string>(`match:${roomId}`);

    if (!raw) {
      throw new Error('Match not found');
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const match = Match.fromPersistence(parsed);

    match.addPlayer(userId);
    await this.saveMatch(match);

    return match;
  }

  disconnectUser(userId: string) {
    const match = this.getMatchByUser(userId);
    if (!match) return;

    match.disconnectPlayer(userId);
  }

  reconnectUser(userId: string) {
    const match = this.getMatchByUser(userId);
    if (!match) return;

    match.reconnectPlayer(userId);
  }

  finishMatch(roomId: string) {
    const match = this.matches.get(roomId);
    if (!match) return;

    const results = match.getResults();
    this.matches.delete(roomId);

    results.forEach((r) => {
      this.userMatchIndex.delete(r.userId);
    });

    return results;
  }

  getMatch(roomId: string): Match | undefined {
    return this.matches.get(roomId);
  }

  private async saveMatch(match: Match): Promise<void> {
    await this.cache.set(`match:${match.getRoomId()}`, JSON.stringify(match.toPersistence()), 300); // todo: definir tll x los times de las questions
  }
}
