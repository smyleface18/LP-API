import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '@/common/src/cache/cache.service';
import { Question, User } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { QuestionService } from '@/modules/question/question.service';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { Match } from './domain/match.entity';
import { ModeMatch } from './domain/match.interface';
import { MatchResultsService } from './match-results.service';
import { MatchService } from './match.service';

const ROOM = 'room-1';

const question = (id: string) =>
  ({
    id,
    timeLimit: 10,
    options: [
      { id: `${id}-ok`, isCorrect: true },
      { id: `${id}-bad`, isCorrect: false },
    ],
  }) as unknown as Question;

const owner = { id: 'u1', username: 'owner', level: Level.A1, score: 50 } as User;

/** Cache en memoria con un await real en get/set, para que la concurrencia se note. */
class MemoryCache {
  store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    await new Promise((r) => setImmediate(r));
    return structuredClone(this.store.get(key)) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await new Promise((r) => setImmediate(r));
    this.store.set(key, structuredClone(value));
  }
}

describe('MatchService', () => {
  let cache: MemoryCache;
  let results: { persist: jest.Mock };
  let service: MatchService;

  const seed = (mutate?: (match: Match) => void) => {
    const match = new Match(
      ROOM,
      Level.A1,
      ModeMatch.MULTIPLAYER,
      [question('q1'), question('q2')],
      owner,
    );
    match.addPlayer('u2', 'guest', Level.A1, 0);
    mutate?.(match);
    cache.store.set(`match:${ROOM}`, structuredClone(match.toPersistence()));
  };

  const score = async (userId: string) =>
    (await service.getMatch(ROOM)).getPlayersWithInfo().find((p) => p.userId === userId)!
      .matchScore;

  beforeEach(() => {
    cache = new MemoryCache();
    results = { persist: jest.fn().mockResolvedValue(new Map([['u1', 150]])) };
    service = new MatchService(
      cache as unknown as CacheService,
      {} as QuestionService,
      {} as UniqueNamesAdapter,
      { emit: jest.fn() } as unknown as EventEmitter2,
      results as unknown as MatchResultsService,
    );
  });

  describe('processAnswer', () => {
    it('scores a correct answer to the active question', async () => {
      seed((m) => m.sendNextQuestion());

      const result = await service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1');

      expect(result.isCorrect).toBe(true);
      expect(await score('u1')).toBe(100);
    });

    it('rejects a second answer to the same question', async () => {
      seed((m) => m.sendNextQuestion());
      await service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1');

      await expect(service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(await score('u1')).toBe(100);
    });

    it('only counts one of several concurrent duplicate answers', async () => {
      seed((m) => m.sendNextQuestion());

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1')),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await score('u1')).toBe(100);
    });

    it('does not lose score when different players answer concurrently', async () => {
      seed((m) => m.sendNextQuestion());

      await Promise.all([
        service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1'),
        service.processAnswer(ROOM, 'q1', 'q1-ok', 'u2'),
      ]);

      expect(await score('u1')).toBe(100);
      expect(await score('u2')).toBe(100);
    });

    it('rejects answers when no question is active (e.g. after timeout)', async () => {
      seed((m) => {
        m.sendNextQuestion();
        m.finishCurrentQuestion();
      });

      await expect(service.processAnswer(ROOM, 'q1', 'q1-ok', 'u1')).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects answers to a question other than the active one', async () => {
      seed((m) => m.sendNextQuestion());

      await expect(service.processAnswer(ROOM, 'q2', 'q2-ok', 'u1')).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects users that are not in the match', async () => {
      seed((m) => m.sendNextQuestion());

      await expect(service.processAnswer(ROOM, 'q1', 'q1-ok', 'intruder')).rejects.toThrow(
        'You are not a player in this match',
      );
    });
  });

  describe('finishMatch', () => {
    it('persists results only once and applies the new total score', async () => {
      seed();

      await service.finishMatch(ROOM);
      const second = await service.finishMatch(ROOM);

      expect(results.persist).toHaveBeenCalledTimes(1);
      expect(second.find((p) => p.userId === 'u1')!.totalScore).toBe(150);
    });
  });
});
