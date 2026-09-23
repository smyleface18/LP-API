import { BadRequestException } from '@nestjs/common';
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
import { ANSWER_GRACE_MS, MIN_QUESTION_LEAD_MS, QUESTION_LEAD_MS, REVEAL_MS } from '../game-timing';

const ROOM = 'room-1';
// Línea de tiempo fija (hora del servidor) para que los tests no dependan del reloj.
const T0 = 1_000_000;
const STARTS_AT = T0;
const ENDS_AT = T0 + 10_000;
const DURING = T0 + 1_000;

/** Deja q1 activa con ventana [STARTS_AT, ENDS_AT]. */
const activate = (m: Match) => m.sendNextQuestion(STARTS_AT, ENDS_AT);

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
      seed(activate);

      const result = await instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING);

      expect(result.isCorrect).toBe(true);
      expect(await score('u1')).toBe(100);
    });

    it('rejects a second answer to the same question, even from another instance', async () => {
      seed(activate);
      await instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING);

      await expect(instanceB.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING)).rejects.toThrow(
        BadRequestException,
      );
      expect(await score('u1')).toBe(100);
    });

    it('only counts one of several concurrent duplicate answers across instances', async () => {
      seed(activate);

      const outcomes = await Promise.allSettled(
        [instanceA, instanceB, instanceA, instanceB, instanceA].map((instance) =>
          instance.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING),
        ),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await score('u1')).toBe(100);
    });

    it('does not lose score when players on different instances answer concurrently', async () => {
      seed(activate);

      await Promise.all([
        instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING),
        instanceB.processAnswer(ROOM, 'q1', 'q1-ok', 'u2', DURING),
      ]);

      expect(await score('u1')).toBe(100);
      expect(await score('u2')).toBe(100);
    });

    it('rejects answers when no question is active (e.g. after timeout)', async () => {
      seed((m) => {
        activate(m);
        m.finishCurrentQuestion();
      });

      await expect(instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', DURING)).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects answers to a question other than the active one', async () => {
      seed(activate);

      await expect(instanceA.processAnswer(ROOM, 'q2', 'q2-ok', 'u1', DURING)).rejects.toThrow(
        'This question is not accepting answers',
      );
    });

    it('rejects users that are not in the match', async () => {
      seed(activate);

      await expect(
        instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'intruder', DURING),
      ).rejects.toThrow('You are not a player in this match');
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

  describe('answer window', () => {
    it('rejects answers that arrive before startsAt', async () => {
      seed(activate);

      await expect(
        instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', STARTS_AT - 1),
      ).rejects.toThrow('This question is not accepting answers');
    });

    it('accepts answers within the network grace after endsAt', async () => {
      seed(activate);

      const result = await instanceA.processAnswer(
        ROOM,
        'q1',
        'q1-ok',
        'u1',
        ENDS_AT + ANSWER_GRACE_MS,
      );

      expect(result.isCorrect).toBe(true);
    });

    it('rejects late answers even if the close job has not run yet', async () => {
      // El match sigue QUESTION_ACTIVE (el scheduler se atrasó), pero la
      // ventana ya venció: la respuesta no debe contar.
      seed(activate);

      await expect(
        instanceA.processAnswer(ROOM, 'q1', 'q1-ok', 'u1', ENDS_AT + ANSWER_GRACE_MS + 1),
      ).rejects.toThrow('This question is not accepting answers');
    });
  });

  describe('game loop timeline', () => {
    const started = (m: Match) => m.start();
    const seqOf = async () => (await instanceA.getMatch(ROOM)).getSeq();

    it('publishes the question anchored to the planned time, not to when the job ran', async () => {
      seed(started);
      const seq = await seqOf();

      // El job corrió 200ms tarde: igual se respeta la línea de tiempo planeada.
      const result = await instanceA.publishNextQuestion(ROOM, seq, T0, T0 + 200);

      expect(result).toMatchObject({
        kind: 'question',
        startsAt: T0 + QUESTION_LEAD_MS,
        endsAt: T0 + QUESTION_LEAD_MS + 10_000,
        questionNumber: 1,
      });
    });

    it('keeps a minimum lead when the scheduler is so late the planned start already passed', async () => {
      seed(started);
      const seq = await seqOf();
      const now = T0 + 10_000;

      const result = await instanceA.publishNextQuestion(ROOM, seq, T0, now);

      expect(result).toMatchObject({ kind: 'question', startsAt: now + MIN_QUESTION_LEAD_MS });
    });

    it('does not send options correctness to clients', async () => {
      seed(started);
      const result = await instanceA.publishNextQuestion(ROOM, await seqOf(), T0, T0);

      expect(result.kind).toBe('question');
      if (result.kind !== 'question') return;
      for (const option of result.question.options) expect(option).not.toHaveProperty('isCorrect');
    });

    it('ignores a duplicated publish job (same step run by two instances)', async () => {
      seed(started);
      const seq = await seqOf();

      const [a, b] = await Promise.all([
        instanceA.publishNextQuestion(ROOM, seq, T0, T0),
        instanceB.publishNextQuestion(ROOM, seq, T0, T0),
      ]);

      expect([a.kind, b.kind].sort()).toEqual(['question', 'stale']);
      expect((await instanceA.getMatch(ROOM)).getcurrentQuestionIndex()).toBe(1);
    });

    it('reschedules a close job that fired early (clock skew between instances)', async () => {
      seed(activate);
      const seq = await seqOf();

      const result = await instanceA.closeQuestion(ROOM, seq, ENDS_AT);

      expect(result).toEqual({ kind: 'early', seq, dueAt: ENDS_AT + ANSWER_GRACE_MS });
      expect((await instanceA.getMatch(ROOM)).isAcceptingAnswers(ENDS_AT)).toBe(true);
    });

    it('closes the question and plans the next one from the planned close time', async () => {
      seed(activate);
      const seq = await seqOf();
      const closeAt = ENDS_AT + ANSWER_GRACE_MS;

      // Corre 1s tarde: la siguiente pregunta igual se planea desde closeAt.
      const result = await instanceA.closeQuestion(ROOM, seq, closeAt + 1_000);

      expect(result).toEqual({
        kind: 'closed',
        seq: seq + 1,
        questionId: 'q1',
        hasNext: true,
        nextPlannedAt: closeAt + REVEAL_MS,
      });
    });

    it('treats jobs from an older phase as stale', async () => {
      seed(activate);
      const oldSeq = (await seqOf()) - 1;

      expect(await instanceA.closeQuestion(ROOM, oldSeq, ENDS_AT + 60_000)).toEqual({
        kind: 'stale',
      });
      expect(await instanceA.publishNextQuestion(ROOM, oldSeq, T0, T0)).toEqual({ kind: 'stale' });
    });

    it('finishes after the last question', async () => {
      seed(started);
      let seq = await seqOf();

      for (const [index, id] of ['q1', 'q2'].entries()) {
        const published = await instanceA.publishNextQuestion(ROOM, seq, T0, T0);
        expect(published).toMatchObject({ kind: 'question', questionNumber: index + 1 });
        if (published.kind !== 'question') return;

        const closed = await instanceB.closeQuestion(
          ROOM,
          published.seq,
          published.endsAt + 10_000,
        );
        expect(closed).toMatchObject({ kind: 'closed', questionId: id, hasNext: index === 0 });
        if (closed.kind !== 'closed') return;
        seq = closed.seq;
      }

      expect((await instanceA.getMatch(ROOM)).getStatus()).toBe('FINISHED');
    });
  });

  describe('requestRematch', () => {
    const finished = (m: Match) => {
      m.start();
      m.finish();
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
