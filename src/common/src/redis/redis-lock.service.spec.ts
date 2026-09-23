import { createClient } from 'redis';
import { EnvsService } from '../envs/envs.service';
import { Level } from '@/db/enum/question.enum';
import { User } from '@/db/entities';
import { Match } from '@/modules/game/match/domain/match.entity';
import { ModeMatch } from '@/modules/game/match/domain/match.interface';
import { LockLostError, MatchStore } from '@/modules/game/match/match.store';
import { LockTimeoutError, RedisLockService } from './redis-lock.service';
import { RedisClient } from './redis.token';

// Integración contra un Redis real. Se salta si no hay REDIS_TEST_URL, ej:
//   docker run -d --rm -p 6390:6379 redis:7-alpine
//   REDIS_TEST_URL=redis://localhost:6390 yarn test
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

describeWithRedis('RedisLockService + MatchStore (real Redis)', () => {
  // Un cliente por "instancia" de la API, como en producción.
  let clientA: RedisClient;
  let clientB: RedisClient;
  let lockA: RedisLockService;
  let lockB: RedisLockService;
  const prefix = `test:${Date.now()}`;

  beforeAll(async () => {
    clientA = createClient({ url: REDIS_TEST_URL });
    clientB = createClient({ url: REDIS_TEST_URL });
    await Promise.all([clientA.connect(), clientB.connect()]);
    lockA = new RedisLockService(clientA);
    lockB = new RedisLockService(clientB);
  });

  afterAll(async () => {
    const keys = await clientA.keys(`*${prefix}*`);
    if (keys.length > 0) await clientA.del(keys);
    await Promise.all([clientA.quit(), clientB.quit()]);
  });

  it('serializes a read-modify-write counter across two clients', async () => {
    const key = `${prefix}:counter`;
    await clientA.set(key, '0');

    const increment = (lock: RedisLockService, client: RedisClient) =>
      lock.withLock(`${prefix}:counter-lock`, async () => {
        const value = Number(await client.get(key));
        await new Promise((resolve) => setTimeout(resolve, 2));
        await client.set(key, String(value + 1));
      });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0 ? increment(lockA, clientA) : increment(lockB, clientB),
      ),
    );

    expect(await clientA.get(key)).toBe('40');
  });

  it('releases the lock when the callback throws', async () => {
    const key = `${prefix}:throw-lock`;

    await expect(
      lockA.withLock(key, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await clientA.get(key)).toBeNull();
  });

  it('gives up with LockTimeoutError when the lock stays taken', async () => {
    const key = `${prefix}:busy-lock`;
    await clientA.set(key, 'someone-else', { expiration: { type: 'PX', value: 5_000 } });

    await expect(
      lockB.withLock(key, () => Promise.resolve('never'), { waitMs: 200 }),
    ).rejects.toThrow(LockTimeoutError);
  });

  it('does not release a lock that expired and was taken by someone else', async () => {
    const key = `${prefix}:expired-lock`;

    await lockA.withLock(
      key,
      async () => {
        // El lock expira mientras la operación sigue y otra instancia lo toma.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await clientB.set(key, 'instance-b');
      },
      { ttlMs: 50 },
    );

    expect(await clientA.get(key)).toBe('instance-b');
  });

  describe('MatchStore fenced save', () => {
    const envs = { matchTtl: 60 } as EnvsService;
    const owner = { id: 'u1', username: 'owner', level: Level.A1, score: 0 } as User;
    const newMatch = (roomId: string) =>
      new Match(roomId, Level.A1, ModeMatch.MULTIPLAYER, [], owner);

    it('create() does not overwrite an existing room', async () => {
      const store = new MatchStore(clientA, lockA, envs);
      const roomId = `${prefix}-room-create`;

      expect(await store.create(newMatch(roomId))).toBe(true);
      expect(await store.create(newMatch(roomId))).toBe(false);
    });

    it('save() fails instead of overwriting when the lock was lost', async () => {
      const storeA = new MatchStore(clientA, lockA, envs);
      const roomId = `${prefix}-room-fenced`;
      const match = newMatch(roomId);
      await storeA.create(match);

      await expect(
        storeA.withRoomLock(roomId, async (lock) => {
          // Otra instancia se quedó con el lock (ej. expiró por una pausa larga).
          await clientB.set(lock.key, 'instance-b');
          match.addPlayer('u2', 'late', Level.A1, 0);
          await storeA.save(match, lock);
        }),
      ).rejects.toThrow(LockLostError);

      const stored = (await storeA.get(roomId)) as { players: unknown[] };
      expect(stored.players).toHaveLength(1);
    });
  });
});
