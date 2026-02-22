import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { EnvsService } from '../envs/envs.service';
import { CACHE_INSTANCE } from './cache.token';
import { Cacheable } from 'cacheable';
import KeyvRedis, { RedisClientOptions } from '@keyv/redis';

@Module({
  providers: [
    {
      provide: CACHE_INSTANCE,
      inject: [EnvsService],
      useFactory: (envs: EnvsService) => {
        const redisOptions: RedisClientOptions = {
          url: `redis://${envs.redisHost}:${envs.redisPort}`,
          socket: {
            reconnectStrategy: (times) => Math.min(times * 50, 2000),
          },
        };

        const secondary = new KeyvRedis(redisOptions);

        return new Cacheable({
          secondary,
          ttl: envs.matchTtl * 1000,
        });
      },
    },
    CacheService,
  ],
  exports: [CACHE_INSTANCE, CacheService],
})
export class CacheModule {}
