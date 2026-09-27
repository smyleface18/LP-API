import { Inject, Injectable } from '@nestjs/common';
import { EnvsService } from '@/common/src/envs/envs.service';
import { REDIS_CLIENT, RedisClient } from '@/common/src/redis/redis.token';
import { LockHandle, RedisLockService } from '@/common/src/redis/redis-lock.service';
import {
  PanelState,
  StoryCharacter,
  StoryGame,
  StorySnapshot,
  StoryStatus,
} from './domain/story-game.types';

export class StoryLockLostError extends Error {
  constructor(gameId: string) {
    super(`Lost the lock for story ${gameId} before saving; the update was discarded`);
    this.name = 'StoryLockLostError';
  }
}

/**
 * La guarda de una escritura no se cumplió: la viñeta ya no está abierta (o la
 * revisión en curso ya no es la misma). No se escribió nada.
 */
export class PanelGuardError extends Error {
  constructor(gameId: string, order: number) {
    super(`Panel ${order} of story ${gameId} is no longer in the expected state`);
    this.name = 'PanelGuardError';
  }
}

/**
 * Condición que Redis verifica en el mismo script, antes de escribir: la
 * viñeta `order` sigue abierta y, si se indica, su revisión en curso es
 * `attemptId`. Así un turno se cierra una sola vez aunque confirmación y
 * timeout lleguen juntos.
 */
export interface PanelGuard {
  order: number;
  attemptId?: string;
}

/** Cambios a aplicar en una sola escritura atómica. */
export interface StoryChanges {
  /** Partida completa: el hash es chico y se reescribe entero. */
  game?: StoryGame;
  /** Personajes nuevos (characterId → personaje). El elenco solo crece. */
  addCharacters?: Record<string, StoryCharacter>;
  setPanels?: PanelState[];
  deletePanels?: number[];
  guard?: PanelGuard;
}

interface HashOps {
  set: [string, string][];
  del: string[];
}

// Crea la partida solo si no existe otra con ese id.
const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
for i = 2, #ARGV, 2 do
  redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1`;

// Escribe solo si el lock sigue siendo nuestro (fencing, como MatchStore.save)
// y, si hay guarda, si la viñeta sigue abierta (y con la misma revisión).
// KEYS: lock, partida, personajes, viñetas. ARGV: token, ttl, ops (json, un
// { set, del } por hash), guarda (json o ''). Devuelve 1 ok, 0 lock perdido,
// -1 guarda incumplida. Todas las claves comparten el hash tag {gameId}.
const FENCED_WRITE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
if ARGV[4] ~= '' then
  local guard = cjson.decode(ARGV[4])
  local raw = redis.call('HGET', KEYS[4], tostring(guard.order))
  if not raw then
    return -1
  end
  local panel = cjson.decode(raw)
  if panel.status ~= 'open' then
    return -1
  end
  if guard.attemptId then
    local reviewing = panel.reviewing
    if type(reviewing) ~= 'table' or reviewing.attemptId ~= guard.attemptId then
      return -1
    end
  end
end
local ops = cjson.decode(ARGV[3])
for i, op in ipairs(ops) do
  local key = KEYS[i + 1]
  for _, pair in ipairs(op.set) do
    redis.call('HSET', key, pair[1], pair[2])
  end
  for _, field in ipairs(op.del) do
    redis.call('HDEL', key, field)
  end
end
for i = 2, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    redis.call('PEXPIRE', KEYS[i], ARGV[2])
  end
end
return 1`;

/**
 * Estado de las partidas de Historieta en Redis, compartido por todas las
 * instancias de la API:
 *
 *   story:{gameId}             hash: status, hostId, config, players, currentPanel, turnEndsAt,
 *                              abandonAt, abandonSeq, createdAt
 *   story:{gameId}:characters  hash: characterId → personaje (json)
 *   story:{gameId}:panels      hash: order → viñeta (json)
 *
 * Toda modificación se hace dentro de `withGameLock` y se guarda con `save`.
 */
@Injectable()
export class StoryStateRepository {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly locks: RedisLockService,
    private readonly envs: EnvsService,
  ) {}

  static gameKey(gameId: string): string {
    return `story:{${gameId}}`;
  }

  static charactersKey(gameId: string): string {
    return `story:{${gameId}}:characters`;
  }

  static panelsKey(gameId: string): string {
    return `story:{${gameId}}:panels`;
  }

  static lockKey(gameId: string): string {
    return `story:{${gameId}}:lock`;
  }

  static userGameKey(userId: string): string {
    return `user:{${userId}}:story`;
  }

  async get(gameId: string): Promise<StorySnapshot | null> {
    const hash = (key: string) => this.redis.hGetAll(key) as Promise<Record<string, string>>;
    const [rawGame, rawCharacters, rawPanels] = await Promise.all([
      hash(StoryStateRepository.gameKey(gameId)),
      hash(StoryStateRepository.charactersKey(gameId)),
      hash(StoryStateRepository.panelsKey(gameId)),
    ]);
    if (!rawGame || Object.keys(rawGame).length === 0) return null;

    const characters: Record<string, StoryCharacter> = {};
    for (const [characterId, character] of Object.entries(rawCharacters ?? {})) {
      characters[characterId] = JSON.parse(character) as StoryCharacter;
    }
    const panels: Record<number, PanelState> = {};
    for (const [order, panel] of Object.entries(rawPanels ?? {})) {
      panels[Number(order)] = JSON.parse(panel) as PanelState;
    }
    return { game: deserializeGame(gameId, rawGame), characters, panels };
  }

  /** Crea la partida solo si no existe otra con ese id. Devuelve false si ya existía. */
  async create(game: StoryGame): Promise<boolean> {
    const fields = serializeGame(game).set.flat();
    const created = await this.redis.eval(CREATE_SCRIPT, {
      keys: [StoryStateRepository.gameKey(game.gameId)],
      arguments: [String(this.ttlMs), ...fields],
    });
    return created === 1;
  }

  async save(gameId: string, lock: LockHandle, changes: StoryChanges): Promise<void> {
    const characters: HashOps = {
      set: Object.entries(changes.addCharacters ?? {}).map(([characterId, character]) => [
        characterId,
        JSON.stringify(character),
      ]),
      del: [],
    };
    const panels: HashOps = {
      set: (changes.setPanels ?? []).map((panel) => [String(panel.order), JSON.stringify(panel)]),
      del: (changes.deletePanels ?? []).map(String),
    };
    const game = changes.game ? serializeGame(changes.game) : { set: [], del: [] };

    const saved = await this.redis.eval(FENCED_WRITE_SCRIPT, {
      keys: [
        lock.key,
        StoryStateRepository.gameKey(gameId),
        StoryStateRepository.charactersKey(gameId),
        StoryStateRepository.panelsKey(gameId),
      ],
      arguments: [
        lock.token,
        String(this.ttlMs),
        JSON.stringify([game, characters, panels]),
        changes.guard ? JSON.stringify(changes.guard) : '',
      ],
    });
    if (saved === -1) throw new PanelGuardError(gameId, changes.guard!.order);
    if (saved !== 1) throw new StoryLockLostError(gameId);
  }

  withGameLock<T>(gameId: string, fn: (lock: LockHandle) => Promise<T>): Promise<T> {
    return this.locks.withLock(StoryStateRepository.lockKey(gameId), fn);
  }

  /**
   * Partida activa de cada usuario, para reincorporarlo al reconectarse (puede
   * caer en otra instancia) y para no dejarlo en dos partidas a la vez.
   */
  async setUserGame(userId: string, gameId: string): Promise<void> {
    await this.redis.set(StoryStateRepository.userGameKey(userId), gameId, {
      expiration: { type: 'PX', value: this.ttlMs },
    });
  }

  async getUserGame(userId: string): Promise<string | null> {
    return this.redis.get(StoryStateRepository.userGameKey(userId));
  }

  /** Borra la partida del usuario solo si sigue siendo `gameId` (pudo unirse a otra). */
  async clearUserGame(userId: string, gameId: string): Promise<void> {
    await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
      { keys: [StoryStateRepository.userGameKey(userId)], arguments: [gameId] },
    );
  }

  private get ttlMs(): number {
    return this.envs.matchTtl * 1000;
  }
}

function serializeGame(game: StoryGame): HashOps {
  const ops: HashOps = {
    set: [
      ['status', game.status],
      ['hostId', game.hostId],
      ['config', JSON.stringify(game.config)],
      ['players', JSON.stringify(game.players)],
      ['abandonSeq', String(game.abandonSeq)],
      ['createdAt', String(game.createdAt)],
    ],
    del: [],
  };
  for (const field of ['currentPanel', 'turnEndsAt', 'abandonAt'] as const) {
    const value = game[field];
    if (value === null) ops.del.push(field);
    else ops.set.push([field, String(value)]);
  }
  return ops;
}

function deserializeGame(gameId: string, raw: Record<string, string>): StoryGame {
  return {
    gameId,
    status: raw.status as StoryStatus,
    hostId: raw.hostId,
    config: JSON.parse(raw.config) as StoryGame['config'],
    players: JSON.parse(raw.players) as StoryGame['players'],
    currentPanel: raw.currentPanel === undefined ? null : Number(raw.currentPanel),
    turnEndsAt: raw.turnEndsAt === undefined ? null : Number(raw.turnEndsAt),
    abandonAt: raw.abandonAt === undefined ? null : Number(raw.abandonAt),
    abandonSeq: Number(raw.abandonSeq ?? 0),
    createdAt: Number(raw.createdAt),
  };
}
