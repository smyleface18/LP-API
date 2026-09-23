import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT, RedisClient } from './redis.token';

export interface LockHandle {
  key: string;
  token: string;
}

export interface LockOptions {
  /** Cuánto vive el lock si el proceso muere sin liberarlo. */
  ttlMs?: number;
  /** Cuánto esperar a que se libere antes de rendirse. */
  waitMs?: number;
}

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`Could not acquire lock ${key}, try again`);
    this.name = 'LockTimeoutError';
  }
}

// Borra el lock solo si sigue siendo nuestro (mismo token): si expiró y otra
// instancia lo tomó, no hay que liberárselo.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_WAIT_MS = 5_000;

/**
 * Lock distribuido sobre un único Redis (SET NX PX + liberación con token).
 * Serializa operaciones entre todas las instancias de la API. Con Redis
 * Cluster/Sentinel un failover puede perder el lock; para eso ver LockHandle:
 * las escrituras protegidas deben verificar el token (fencing) en el mismo
 * script que escribe, así un lock perdido hace fallar la escritura en vez de
 * pisar la de otra instancia.
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async withLock<T>(
    key: string,
    fn: (lock: LockHandle) => Promise<T>,
    { ttlMs = DEFAULT_TTL_MS, waitMs = DEFAULT_WAIT_MS }: LockOptions = {},
  ): Promise<T> {
    const lock: LockHandle = { key, token: randomUUID() };
    await this.acquire(lock, ttlMs, waitMs);

    try {
      return await fn(lock);
    } finally {
      await this.redis
        .eval(RELEASE_SCRIPT, { keys: [lock.key], arguments: [lock.token] })
        .catch((error: Error) => this.logger.warn(`release ${key} failed: ${error.message}`));
    }
  }

  private async acquire(lock: LockHandle, ttlMs: number, waitMs: number): Promise<void> {
    const deadline = Date.now() + waitMs;
    let delay = 10;

    for (;;) {
      const acquired = await this.redis.set(lock.key, lock.token, {
        condition: 'NX',
        expiration: { type: 'PX', value: ttlMs },
      });
      if (acquired === 'OK') return;

      if (Date.now() >= deadline) throw new LockTimeoutError(lock.key);

      // Backoff exponencial con jitter para no martillar Redis ni sincronizar reintentos.
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay));
      delay = Math.min(delay * 2, 100);
    }
  }
}
