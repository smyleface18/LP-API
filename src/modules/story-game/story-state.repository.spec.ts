import { EnvsService } from '@/common/src/envs/envs.service';
import { RedisLockService } from '@/common/src/redis/redis-lock.service';
import { RedisClient } from '@/common/src/redis/redis.token';
import {
  PanelGuardError,
  StoryLockLostError,
  StoryStateRepository,
} from './story-state.repository';
import { PanelState, StoryGame, StoryStatus } from './domain/story-game.types';
import { STORY_DEFAULT_CONFIG } from './story-game.config';

const PANEL: PanelState = {
  order: 0,
  authorId: 'alice',
  status: 'open',
  attempts: 0,
  submissions: 0,
  drafts: [],
  reviewing: null,
  closeWhenReviewed: false,
  originalText: null,
  finalText: null,
  scene: null,
  characterIds: [],
  score: null,
  confirmedBy: null,
  reactions: {},
};

const GAME: StoryGame = {
  gameId: 'brave-red-fox',
  status: StoryStatus.LOBBY,
  hostId: 'alice',
  config: { ...STORY_DEFAULT_CONFIG },
  players: [
    {
      userId: 'alice',
      username: 'Alice',
      connected: true,
      left: false,
      joinedAt: 1,
      totalScore: 0,
      panelsWritten: 0,
    },
  ],
  currentPanel: null,
  turnEndsAt: null,
  turnCloseAt: null,
  abandonAt: null,
  abandonSeq: 0,
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
    const playing = {
      ...GAME,
      status: StoryStatus.PLAYING,
      currentPanel: 2,
      turnEndsAt: 99,
      abandonAt: 5,
      abandonSeq: 3,
    };
    await repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: playing });

    const [gameOps] = JSON.parse(evalOptions().arguments[2]) as {
      set: [string, string][];
      del: string[];
    }[];
    redis.hGetAll.mockImplementation((key: string) =>
      Promise.resolve(
        key.endsWith(':characters')
          ? { c1: JSON.stringify({ name: 'Luna' }) }
          : key.endsWith(':panels')
            ? { '0': JSON.stringify(PANEL) }
            : Object.fromEntries(gameOps.set),
      ),
    );

    expect(await repository.get(GAME.gameId)).toEqual({
      game: playing,
      characters: { c1: { name: 'Luna' } },
      panels: { 0: PANEL },
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
      { addCharacters: { c2: { name: 'Max' } as never } },
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
      { set: [['c2', JSON.stringify({ name: 'Max' })]], del: [] },
      { set: [], del: [] },
    ]);
  });

  it('deletes the nullable fields when they go back to null', async () => {
    redis.eval.mockResolvedValue(1);
    await repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: GAME });
    const [gameOps] = JSON.parse(evalOptions().arguments[2]) as { del: string[] }[];
    expect(gameOps.del).toEqual(['currentPanel', 'turnEndsAt', 'turnCloseAt', 'abandonAt']);
  });

  it('throws when the lock was lost before writing', async () => {
    redis.eval.mockResolvedValue(0);
    await expect(
      repository.save(GAME.gameId, { key: 'lock', token: 'tok' }, { game: GAME }),
    ).rejects.toBeInstanceOf(StoryLockLostError);
  });

  it('writes and deletes panels by order', async () => {
    redis.eval.mockResolvedValue(1);
    await repository.save(
      GAME.gameId,
      { key: 'lock', token: 'tok' },
      { setPanels: [PANEL], deletePanels: [3] },
    );
    const [, , panelOps] = JSON.parse(evalOptions().arguments[2]) as unknown[];
    expect(panelOps).toEqual({ set: [['0', JSON.stringify(PANEL)]], del: ['3'] });
    expect(evalOptions().arguments[3]).toBe('');
  });

  it('sends the panel guard and reports when Redis rejects it', async () => {
    redis.eval.mockResolvedValue(-1);
    await expect(
      repository.save(
        GAME.gameId,
        { key: 'lock', token: 'tok' },
        { setPanels: [PANEL], guard: { order: 0, attemptId: 'a1' } },
      ),
    ).rejects.toBeInstanceOf(PanelGuardError);
    expect(JSON.parse(evalOptions().arguments[3])).toEqual({ order: 0, attemptId: 'a1' });
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
        game: { ...game, status: StoryStatus.PLAYING, currentPanel: 0, abandonAt: 7 },
        addCharacters: { c1: { name: 'Luna' } as never },
      }),
    );
    const snapshot = await repository.get(gameId);
    expect(snapshot?.game.status).toBe(StoryStatus.PLAYING);
    expect(snapshot?.game.abandonAt).toBe(7);
    expect(snapshot?.game.currentPanel).toBe(0);
    expect(snapshot?.characters).toEqual({ c1: { name: 'Luna' } });
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

    await repository.withGameLock(gameId, (lock) => repository.save(gameId, lock, { game }));
    const cleared = await repository.get(gameId);
    expect(cleared?.game.currentPanel).toBeNull();
    expect(cleared?.game.abandonAt).toBeNull();
    // El elenco solo crece.
    expect(cleared?.characters).toEqual({ c1: { name: 'Luna' } });
  });

  it('applies the panel guard atomically', async () => {
    const guarded = `${gameId}-guard`;
    await repository.create({ ...GAME, gameId: guarded });
    const save = (changes: Parameters<StoryStateRepository['save']>[2]) =>
      repository.withGameLock(guarded, (lock) => repository.save(guarded, lock, changes));

    await save({ setPanels: [{ ...PANEL, reviewing: { attemptId: 'a1', startedAt: 1 } }] });
    // Revisión distinta a la en curso: rechazada.
    await expect(
      save({ setPanels: [PANEL], guard: { order: 0, attemptId: 'zz' } }),
    ).rejects.toBeInstanceOf(PanelGuardError);
    // Cierre con la viñeta abierta: pasa una vez; el segundo cierre se rechaza.
    const closed = { ...PANEL, status: 'closed' as const };
    await save({ setPanels: [closed], guard: { order: 0 } });
    await expect(save({ setPanels: [closed], guard: { order: 0 } })).rejects.toBeInstanceOf(
      PanelGuardError,
    );
    // Viñeta inexistente: rechazada.
    await expect(save({ guard: { order: 5 } })).rejects.toBeInstanceOf(PanelGuardError);

    const keys = await client.keys(`*${guarded}*`);
    await client.del(keys);
  });
});
