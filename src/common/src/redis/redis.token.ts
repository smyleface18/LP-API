import { createClient } from 'redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export type RedisClient = ReturnType<typeof createClient>;
