import { User } from 'src/db/entities';
import { ModeMatch } from './domain/match.interface';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { CacheService } from 'src/common/src/cache/cache.service';
import { Level } from 'src/db/enum/question.enum';
import { QuestionService } from 'src/modules/question/question.service';

@Injectable()
export class MatchService {
  private matches = new Map<string, Match>();
  private userMatchIndex = new Map<string, string>();

  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch): Promise<void> {
    const questions = await this.questionService.getRandomQuestions(); // todo: bucar questions x level
    const match = new Match(difficulty, mode, questions);
    await this.cache.set(`match:${match.getRoomId()}`, match, 300); // todo: definir tll x los times de las questions
  }

  joinMatch(roomId: string, user: User): Match {
    const match = this.matches.get(roomId);

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    match.addPlayer(user.username);
    this.userMatchIndex.set(user.id, roomId);

    return match;
  }

  getMatchByUser(userId: string): Match | undefined {
    const roomId = this.userMatchIndex.get(userId);
    if (!roomId) return undefined;

    return this.matches.get(roomId);
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
}
