import { Inject, Injectable } from '@nestjs/common';
import { EnvsService } from '@/common/src/envs/envs.service';
import { REDIS_CLIENT, RedisClient } from '@/common/src/redis/redis.token';
import { LockHandle, RedisLockService } from '@/common/src/redis/redis-lock.service';
import { Match } from './domain/match.entity';

export class LockLostError extends Error {
  constructor(roomId: string) {
    super(`Lost the lock for match ${roomId} before saving; the update was discarded`);
    this.name = 'LockLostError';
  }
}

// Escribe el match solo si el lock sigue siendo nuestro, en una sola operación
// atómica. Las dos claves comparten el hash tag {roomId}, así caen en el mismo
// slot si algún día se usa Redis Cluster.
const FENCED_SET_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1`;

/**
 * Estado de los matches en Redis, compartido por todas las instancias de la
 * API. Toda modificación debe hacerse dentro de `withRoomLock` y guardarse con
 * `save(match, lock)`.
 */
@Injectable()
export class MatchStore {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly locks: RedisLockService,
    private readonly envs: EnvsService,
  ) {}

  static matchKey(roomId: string): string {
    return `match:{${roomId}}`;
  }

  static lockKey(roomId: string): string {
    return `match:{${roomId}}:lock`;
  }

  static userRoomKey(userId: string): string {
    return `user:{${userId}}:room`;
  }

  /**
   * Sala activa de cada usuario, para reincorporarlo al reconectarse. Vive en
   * Redis (no en el socket) porque la reconexión puede caer en otra instancia.
   */
  async setUserRoom(userId: string, roomId: string): Promise<void> {
    await this.redis.set(MatchStore.userRoomKey(userId), roomId, {
      expiration: { type: 'PX', value: this.ttlMs },
    });
  }

  async getUserRoom(userId: string): Promise<string | null> {
    return this.redis.get(MatchStore.userRoomKey(userId));
  }

  /** Borra la sala del usuario solo si sigue siendo `roomId` (pudo unirse a otra). */
  async clearUserRoom(userId: string, roomId: string): Promise<void> {
    await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
      { keys: [MatchStore.userRoomKey(userId)], arguments: [roomId] },
    );
  }

  async get(roomId: string): Promise<unknown> {
    const raw = await this.redis.get(MatchStore.matchKey(roomId));
    return raw ? (JSON.parse(raw) as unknown) : null;
  }

  /** Crea el match solo si no existe otro con ese roomId. Devuelve false si ya existía. */
  async create(match: Match): Promise<boolean> {
    const result = await this.redis.set(
      MatchStore.matchKey(match.getRoomId()),
      JSON.stringify(match.toPersistence()),
      { condition: 'NX', expiration: { type: 'PX', value: this.ttlMs } },
    );
    return result === 'OK';
  }

  async save(match: Match, lock: LockHandle): Promise<void> {
    const saved = await this.redis.eval(FENCED_SET_SCRIPT, {
      keys: [lock.key, MatchStore.matchKey(match.getRoomId())],
      arguments: [lock.token, JSON.stringify(match.toPersistence()), String(this.ttlMs)],
    });
    if (saved !== 1) throw new LockLostError(match.getRoomId());
  }

  withRoomLock<T>(roomId: string, fn: (lock: LockHandle) => Promise<T>): Promise<T> {
    return this.locks.withLock(MatchStore.lockKey(roomId), fn);
  }

  private get ttlMs(): number {
    return this.envs.matchTtl * 1000;
  }
}
