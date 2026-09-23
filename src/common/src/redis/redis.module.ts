import { Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { EnvsService } from '../envs/envs.service';
import { REDIS_CLIENT, RedisClient } from './redis.token';
import { RedisLockService } from './redis-lock.service';

/**
 * Cliente Redis directo (sin capa en memoria), para estado compartido entre
 * instancias de la API. No usar CacheService/Cacheable para eso: su capa
 * primaria es un Map en memoria de cada proceso y devolvería datos viejos
 * cuando otra instancia actualiza la misma clave.
 */
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [EnvsService],
      useFactory: async (envs: EnvsService): Promise<RedisClient> => {
        const logger = new Logger('Redis');
        const client = createClient({
          url: `redis://${envs.redisHost}:${envs.redisPort}`,
          socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 2000) },
        });
        client.on('error', (error: Error) => logger.error(error.message));
        await client.connect();
        return client;
      },
    },
    RedisLockService,
  ],
  exports: [REDIS_CLIENT, RedisLockService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onApplicationShutdown() {
    if (this.client.isOpen) await this.client.quit();
  }
}
