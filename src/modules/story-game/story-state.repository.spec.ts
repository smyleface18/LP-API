import { EnvsService } from '@/common/src/envs/envs.service';
import { RedisLockService } from '@/common/src/redis/redis-lock.service';
import { RedisClient } from '@/common/src/redis/redis.token';
import { StoryLockLostError, StoryStateRepository } from './story-state.repository';
import { StoryGame, StoryStatus } from './domain/story-game.types';
import { STORY_DEFAULT_CONFIG } from './story-game.config';

const GAME: StoryGame = {
  gameId: 'brave-red-fox',
  status: StoryStatus.LOBBY,
  hostId: 'alice',
  config: { ...STORY_DEFAULT_CONFIG },
  players: [{ userId: 'alice', username: 'Alice', connected: true, left: false, joinedAt: 1 }],
  currentPanel: null,
  turnEndsAt: null,
  createdAt: 1,
};

interface EvalOptions {
  keys: string[];
  arguments: string[];
}

describe('StoryStateRepository (mocked Redis)', () => {
  let redis: { hGetAll: jest.Mock; eval: jest.Mock; get: jest.Mock; set: jest.Mock };
  let repository: StoryStateRepository;

  beforeEach(() => {
    redis = { hGetAll: jest.fn(), eval: jest.fn(), get: jest.fn(), set: jest.fn() };
    repository = new StoryStateRepository(
      redis as unknown as RedisClient,
      {} as RedisLockService,
      { matchTtl: 3600 } as EnvsService,
    );
  });

  const evalOptions = (call = 0) => (redis.eval.mock.calls as [string, EvalOptions][])[call][1];

  it('uses keys that share the {gameId} hash tag', () => {
    expect(StoryStateRepository.gameKey('g')).toBe('story:{g}');
    expect(StoryStateRepository.charactersKey('g')).toBe('story:{g}:characters');
    expect(StoryStateRepository.panelsKey('g')).toBe('story:{g}:panels');
    expect(StoryStateRepository.lockKey('g')).toBe('story:{g}:lock');
  });

  it('creates the game hash with MATCH_TTL and without the null fields', async () => {
    redis.eval.mockResolvedValue(1);
    expect(await repository.create(GAME)).toBe(true);

    const { keys, arguments: args } = evalOptions();
    expect(keys).toEqual(['story:{brave-red-fox}']);
    expect(args[0]).toBe('3600000');
    const fields = Object.fromEntries(
      args.slice(1).flatMap((_, i, rest) => (i % 2 === 0 ? [[rest[i], rest[i + 1]]] : [])),
    ) as Record<string, string>;
    expect(fields.status).toBe('LOBBY');
    expect(JSON.parse(fields.players)).toEqual(GAME.players);
    expect(fields).not.toHaveProperty('currentPanel');
  });

  it('reports an existing id on create', async () => {
    redis.eval.mockResolvedValue(0);
    expect(await repository.create(GAME)).toBe(false);
  });

  it('round-trips a game through the hash format', async () => {
    redis.eval.mockResolvedValue(1);
    const playing = { ...GAME, status: StoryStatus.PLAYING, currentPanel: 2, turnEndsAt: 99 };
    await repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: playing });

    const [gameOps] = JSON.parse(evalOptions().arguments[2]) as {
      set: [string, string][];
      del: string[];
    }[];
    redis.hGetAll.mockImplementation((key: string) =>
      Promise.resolve(
        key.endsWith(':characters')
          ? { alice: JSON.stringify({ name: 'Luna' }) }
          : Object.fromEntries(gameOps.set),
      ),
    );

    expect(await repository.get(GAME.gameId)).toEqual({
      game: playing,
      characters: { alice: { name: 'Luna' } },
    });
  });

  it('returns null for a missing game', async () => {
    redis.hGetAll.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('sends a fenced write with the lock token and one op per hash', async () => {
    redis.eval.mockResolvedValue(1);
    await repository.save(
      GAME.gameId,
      { key: 'story:{brave-red-fox}:lock', token: 'tok' },
      { setCharacters: { bob: { name: 'Max' } as never }, deleteCharacters: ['carol'] },
    );

    const { keys, arguments: args } = evalOptions();
    expect(keys).toEqual([
      'story:{brave-red-fox}:lock',
      'story:{brave-red-fox}',
      'story:{brave-red-fox}:characters',
      'story:{brave-red-fox}:panels',
    ]);
    expect(args[0]).toBe('tok');
    expect(JSON.parse(args[2])).toEqual([
      { set: [], del: [] },
      { set: [['bob', JSON.stringify({ name: 'Max' })]], del: ['carol'] },
      { set: [], del: [] },
    ]);
  });

  it('deletes currentPanel/turnEndsAt when they go back to null', async () => {
    redis.eval.mockResolvedValue(1);
    await repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: GAME });
    const [gameOps] = JSON.parse(evalOptions().arguments[2]) as { del: string[] }[];
    expect(gameOps.del).toEqual(['currentPanel', 'turnEndsAt']);
  });

  it('throws when the lock was lost before writing', async () => {
    redis.eval.mockResolvedValue(0);
    await expect(
      repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: GAME }),
    ).rejects.toBeInstanceOf(StoryLockLostError);
  });
});

// Integración de los scripts Lua contra un Redis real. Se salta si no hay
// REDIS_TEST_URL, ej:
//   docker run -d --rm -p 6390:6379 redis:7-alpine
//   REDIS_TEST_URL=redis://localhost:6390 yarn test
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

describeWithRedis('StoryStateRepository (real Redis)', () => {
  let client: RedisClient;
  let repository: StoryStateRepository;
  const gameId = `test-story-${Date.now()}`;

  beforeAll(async () => {
    // Import diferido: el bloque con mocks no necesita el cliente real.
    const { createClient } = await import('redis');
    client = createClient({ url: REDIS_TEST_URL });
    await client.connect();
    repository = new StoryStateRepository(client, new RedisLockService(client), {
      matchTtl: 60,
    } as EnvsService);
  });

  afterAll(async () => {
    const keys = await client.keys(`*${gameId}*`);
    if (keys.length > 0) await client.del(keys);
    await client.quit();
  });

  it('creates once, writes under the lock and refuses a stale token', async () => {
    const game = { ...GAME, gameId };
    expect(await repository.create(game)).toBe(true);
    expect(await repository.create(game)).toBe(false);

    await repository.withGameLock(gameId, (lock) =>
      repository.save(gameId, lock, {
        game: { ...game, status: StoryStatus.CHARACTERS, currentPanel: 0 },
        setCharacters: { alice: { name: 'Luna' } as never },
      }),
    );
    const snapshot = await repository.get(gameId);
    expect(snapshot?.game.status).toBe(StoryStatus.CHARACTERS);
    expect(snapshot?.game.currentPanel).toBe(0);
    expect(snapshot?.characters).toEqual({ alice: { name: 'Luna' } });
    expect(await client.pTTL(StoryStateRepository.charactersKey(gameId))).toBeGreaterThan(0);

    await expect(
      repository.save(
        gameId,
        { key: StoryStateRepository.lockKey(gameId), token: 'stale' },
        {
          game,
        },
      ),
    ).rejects.toBeInstanceOf(StoryLockLostError);

    await repository.withGameLock(gameId, (lock) =>
      repository.save(gameId, lock, { game, deleteCharacters: ['alice'] }),
    );
    const cleared = await repository.get(gameId);
    expect(cleared?.game.currentPanel).toBeNull();
    expect(cleared?.characters).toEqual({});
  });
});
