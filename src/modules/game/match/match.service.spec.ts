import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LockHandle } from '@/common/src/redis/redis-lock.service';
import { Question, User } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { QuestionService } from '@/modules/question/question.service';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { Match } from './domain/match.entity';
import { ModeMatch } from './domain/match.interface';
import { MatchResultsService } from './match-results.service';
import { MatchService } from './match.service';
import { MatchStore } from './match.store';

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

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Imita a Redis en memoria: datos y locks compartidos, con awaits reales en
 * cada operación para que las carreras aparezcan. Varias MatchService sobre el
 * mismo backend simulan varias instancias de la API.
 */
class FakeRedisBackend {
  data = new Map<string, string>();
  locks = new Map<string, string>();
}

class FakeMatchStore {
  private counter = 0;

  constructor(private readonly backend: FakeRedisBackend) {}

  async get(roomId: string): Promise<unknown> {
    await tick();
    const raw = this.backend.data.get(roomId);
    return raw ? JSON.parse(raw) : null;
  }

  async create(match: Match): Promise<boolean> {
    await tick();
    if (this.backend.data.has(match.getRoomId())) return false;
    this.backend.data.set(match.getRoomId(), JSON.stringify(match.toPersistence()));
    return true;
  }

  async save(match: Match, lock: LockHandle): Promise<void> {
    await tick();
    if (this.backend.locks.get(lock.key) !== lock.token) throw new Error('lock lost');
    this.backend.data.set(match.getRoomId(), JSON.stringify(match.toPersistence()));
  }

  async withRoomLock<T>(roomId: string, fn: (lock: LockHandle) => Promise<T>): Promise<T> {
    const lock = { key: `lock:${roomId}`, token: `t${++this.counter}-${Math.random()}` };
    while (this.backend.locks.has(lock.key)) await tick();
    this.backend.locks.set(lock.key, lock.token);
    try {
      return await fn(lock);
    } finally {
      if (this.backend.locks.get(lock.key) === lock.token) this.backend.locks.delete(lock.key);
    }
  }
}

describe('MatchService', () => {
  let backend: FakeRedisBackend;
  let results: { persist: jest.Mock };
  // Dos "instancias" de la API sobre el mismo Redis.
  let instanceA: MatchService;
  let instanceB: MatchService;

  const createService = () =>
    new MatchService(
      new FakeMatchStore(backend) as unknown as MatchStore,
      {} as QuestionService,
      {} as UniqueNamesAdapter,
      { emit: jest.fn() } as unknown as EventEmitter2,
      results as unknown as MatchResultsService,
    );

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
    backend.data.set(ROOM, JSON.stringify(match.toPersistence()));
  };

  const score = async (userId: string) =>
    (await instanceA.getMatch(ROOM)).getPlayersWithInfo().find((p) => p.userId === userId)!
      .matchScore;

  beforeEach(() => {
    backend = new FakeRedisBackend();
    results = { persist: jest.fn().mockResolvedValue(new Map([['u1', 150]])) };
    instanceA = createService();
    instanceB = createService();
  });

  describe('processAnswer', () => {
    it('scores a correct answer to the active question', async () => {
      seed((m) => m.sendNextQuestion());

      const result = await instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1');

      expect(result.isCorrect).toBe(true);
      expect(await score('u1')).toBe(100);
    });

    it('rejects a second answer to the same question, even from another instance', async () => {
      seed((m) => m.sendNextQuestion());
      await instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1');

      await expect(instanceB.processAnswer(ROOM, 'q1', 'q1-ok', 'u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(await score('u1')).toBe(100);
    });

    it('only counts one of several concurrent duplicate answers across instances', async () => {
      seed((m) => m.sendNextQuestion());

      const outcomes = await Promise.allSettled(
        [instanceA, instanceB, instanceA, instanceB, instanceA].map((instance) =>
          instance.processAnswer(ROOM, 'q1', 'q1-ok', 'u1'),
        ),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await score('u1')).toBe(100);
    });

    it('does not lose score when players on different instances answer concurrently', async () => {
      seed((m) => m.sendNextQuestion());

      await Promise.all([
        instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1'),
        instanceB.processAnswer(ROOM, 'q1', 'q1-ok', 'u2'),
      ]);

      expect(await score('u1')).toBe(100);
      expect(await score('u2')).toBe(100);
    });

    it('rejects answers when no question is active (e.g. after timeout)', async () => {
      seed((m) => {
        m.sendNextQuestion();
        m.finishCurrentQuestion();
      });

      await expect(instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1')).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects answers to a question other than the active one', async () => {
      seed((m) => m.sendNextQuestion());

      await expect(instanceA.processAnswer(ROOM, 'q2', 'q2-ok', 'u1')).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects users that are not in the match', async () => {
      seed((m) => m.sendNextQuestion());

      await expect(instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'intruder')).rejects.toThrow(
        'You are not a player in this match',
      );
    });
  });

  describe('finishMatch', () => {
    it('persists results only once even if both instances finish concurrently', async () => {
      seed();

      const [first, second] = await Promise.all([
        instanceA.finishMatch(ROOM),
        instanceB.finishMatch(ROOM),
      ]);

      expect(results.persist).toHaveBeenCalledTimes(1);
      expect(first.find((p) => p.userId === 'u1')!.totalScore).toBe(150);
      expect(second.find((p) => p.userId === 'u1')!.totalScore).toBe(150);
    });
  });

  describe('requestRematch', () => {
    const finished = (m: Match) => {
      m.sendNextQuestion();
      m.sendNextQuestion();
      m.sendNextQuestion(); // sin más preguntas -> FINISHED
    };

    it('counts votes from players connected to different instances', async () => {
      seed(finished);

      const first = await instanceA.requestRematch(ROOM, 'u1');
      const second = await instanceB.requestRematch(ROOM, 'u2');

      expect(first).toEqual({ accepted: 1, total: 2 });
      expect(second.accepted).toBe(2);
      expect(second.rematch).toBeDefined();
    });

    it('does not double count repeated votes from the same player', async () => {
      seed(finished);

      await instanceA.requestRematch(ROOM, 'u1');
      const again = await instanceB.requestRematch(ROOM, 'u1');

      expect(again).toEqual({ accepted: 1, total: 2 });
    });

    it('rejects votes before the match is finished', async () => {
      seed();

      await expect(instanceA.requestRematch(ROOM, 'u1')).rejects.toThrow(
        'The game is not finished yet.',
      );
    });
  });
});
